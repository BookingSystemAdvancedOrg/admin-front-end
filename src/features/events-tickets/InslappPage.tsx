import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, Button, Card, Field, Input, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { ERRORS, TICKET_LABEL, getGuestList, newId, sendCheckIns, type CheckIn, type Ticket } from './api'
import { clearScan, loadScan, parseCode, saveScan, signature, type ScanState } from './scanStore'

interface Detector { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorCtor = new (opts: { formats: string[] }) => Detector

const SYNC_MS = 15000

function time(iso?: string): string {
  return iso ? new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * Insläppet vid dörren (ägare och personal): gästlistan med sök, "Släpp in"
 * per biljett, kameraskanning med webbläsarens BarcodeDetector och en
 * inskriven kod som reserv. Fungerar utan nät: koden kontrolleras med
 * tillfällets scan-nyckel och insläppen köas tills de kan skickas.
 */
export default function InslappPage({ locationId, eventId, occurrenceId }: { locationId: string; eventId: string; occurrenceId: string }) {
  const [state, setState] = useState<ScanState | null>(null)
  const [search, setSearch] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [camera, setCamera] = useState(false)
  const stateRef = useRef<ScanState | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const update = useCallback(async (next: ScanState) => {
    stateRef.current = next
    setState(next)
    await saveScan(occurrenceId, next)
  }, [occurrenceId])

  const refresh = useCallback(async () => {
    const saved = stateRef.current ?? await loadScan(occurrenceId)
    try {
      const list = await getGuestList(locationId, eventId, occurrenceId)
      await update({ ...saved, list })
    } catch (err) {
      stateRef.current = saved
      setState(saved)
      if (!saved.list) toast(errorText(err, 'Kunde inte hämta gästlistan.', ERRORS), { tone: 'danger' })
    }
  }, [eventId, locationId, occurrenceId, update])

  const sync = useCallback(async () => {
    const current = stateRef.current
    if (!current || !current.queue.length || syncing) return
    setSyncing(true)
    try {
      const batch = current.queue.slice(0, 200)
      const { results } = await sendCheckIns(locationId, eventId, occurrenceId, batch)
      const sent = new Set(batch.map((c) => c.clientId))
      const already = results.filter((r) => r.status === 'already')
      for (const r of already) {
        const item = batch.find((c) => c.clientId === r.clientId)
        if (item && current.local[item.ticketId] !== r.at) {
          setNotice({ tone: 'warning', text: `Redan insläppt ${time(r.at)}${r.by ? ` av ${r.by}` : ''}.` })
        }
      }
      const latest = stateRef.current ?? current
      await update({ ...latest, queue: latest.queue.filter((c) => !sent.has(c.clientId)) })
      await refresh()
      const done = stateRef.current
      const ended = done?.list && done.queue.length === 0 && Date.now() > Date.parse(occurrenceEnd(occurrenceId)) + 86400000
      if (ended) await clearScan(occurrenceId)
    } catch {
      // Inget nät eller servern svarar inte: kön ligger kvar och skickas nästa gång.
    } finally {
      setSyncing(false)
    }
  }, [eventId, locationId, occurrenceId, refresh, syncing, update])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const up = () => { setOnline(true); void sync() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    const timer = window.setInterval(() => { void sync() }, SYNC_MS)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
      window.clearInterval(timer)
    }
  }, [sync])

  const admit = useCallback(async (ticketId: string, sig: string | null) => {
    const current = stateRef.current
    if (!current?.list) return
    const ticket = current.list.tickets.find((t) => t.ticketId === ticketId)
    const realSig = sig ?? await signature(current.list.scanKey, ticketId)
    if (!ticket || realSig !== await signature(current.list.scanKey, ticketId)) {
      setNotice({ tone: 'danger', text: 'Biljetten gäller inte för det här tillfället.' })
      return
    }
    if (ticket.status !== 'valid' || current.local[ticketId]) {
      const at = current.local[ticketId] ?? ticket.checkedInAt
      setNotice(ticket.status === 'checked_in' || current.local[ticketId]
        ? { tone: 'warning', text: `Redan insläppt ${time(at)}.` }
        : { tone: 'danger', text: `Biljetten gäller inte (${TICKET_LABEL[ticket.status].toLowerCase()}).` })
      return
    }
    const at = new Date().toISOString()
    const item: CheckIn = { ticketId, sig: realSig, at, clientId: newId() }
    await update({ ...current, queue: [...current.queue, item], local: { ...current.local, [ticketId]: at } })
    setNotice({ tone: 'success', text: `Välkommen, ${ticket.holderName || 'gäst'}! ${ticket.typeName}` })
    void sync()
  }, [sync, update])

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseCode(code)
    if (!parsed) {
      setNotice({ tone: 'danger', text: 'Koden känns inte igen. Skriv av hela koden under QR-koden.' })
      return
    }
    await admit(parsed.ticketId, parsed.sig)
    setCode('')
  }

  useEffect(() => {
    if (!camera) return
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) {
      setNotice({ tone: 'warning', text: 'Den här webbläsaren kan inte läsa QR-koder med kameran. Skriv in koden i stället.' })
      setCamera(false)
      return
    }
    let stream: MediaStream | null = null
    let stopped = false
    let last = ''
    const detector = new Ctor({ formats: ['qr_code'] })
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(async (s) => {
      stream = s
      const video = videoRef.current
      if (!video || stopped) return
      video.srcObject = s
      await video.play().catch(() => undefined)
      const tick = async () => {
        if (stopped) return
        try {
          const found = await detector.detect(video)
          const raw = found[0]?.rawValue ?? ''
          const parsed = raw && raw !== last ? parseCode(raw) : null
          if (parsed) {
            last = raw
            await admit(parsed.ticketId, parsed.sig)
          }
        } catch {
          // en bild som inte gick att läsa: nästa
        }
        window.requestAnimationFrame(() => { void tick() })
      }
      void tick()
    }).catch(() => {
      setNotice({ tone: 'warning', text: 'Kameran gick inte att starta. Skriv in koden i stället.' })
      setCamera(false)
    })
    return () => {
      stopped = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [admit, camera])

  const list = state?.list
  const localCount = state ? Object.keys(state.local).filter((id) => list?.tickets.find((t) => t.ticketId === id)?.status === 'valid').length : 0
  const checkedIn = (list?.counters.checkedIn ?? 0) + localCount
  const sold = list?.counters.sold ?? 0
  const needle = search.trim().toLowerCase()
  const rows: Ticket[] = (list?.tickets ?? []).filter((t) => !needle || t.holderName.toLowerCase().includes(needle))

  return (
    <>
      <p className="evenemang-back"><Link to={`/evenemang/${encodeURIComponent(eventId)}`}>Tillbaka till evenemanget</Link></p>
      {!online || (state?.queue.length ?? 0) > 0 ? (
        <Bar variant="banner" tone={online ? 'info' : 'warning'}>
          {online ? `${state?.queue.length} insläpp skickas…` : `Ingen anslutning. Insläppen sparas här och skickas när nätet är tillbaka (${state?.queue.length ?? 0} i kö).`}
        </Bar>
      ) : null}
      <Card title="Insläpp">
        <Bar variant="meter" value={checkedIn} max={Math.max(sold, 1)} label="Insläppta"
          valueText={`${checkedIn} insläppta av ${sold} sålda (${list?.counters.capacity ?? 0} platser)`} />
        <div className="evenemang-scan">
          <form onSubmit={(e) => { void submitCode(e) }} className="evenemang-code">
            <Field label="Biljettkod" hint="Står under QR-koden på biljetten.">
              <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Button type="submit" variant="primary" disabled={!list}>Släpp in</Button>
          </form>
          <Button type="button" variant="secondary" onClick={() => setCamera((c) => !c)} disabled={!list}>
            {camera ? 'Stäng kameran' : 'Skanna med kameran'}
          </Button>
        </div>
        {camera ? <video ref={videoRef} className="evenemang-video" muted playsInline aria-label="Kamerabild för QR-koder" /> : null}
        <div aria-live="polite">
          {notice ? <Bar variant="banner" tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel="Stäng">{notice.text}</Bar> : null}
        </div>
      </Card>
      <Card title="Gästlista">
        <Field label="Sök på namn">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {list && rows.length === 0 ? <p className="admin-empty">Inga biljetter.</p> : null}
        {rows.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Namn</th><th scope="col">Biljett</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Åtgärd</span></th></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const localAt = state?.local[t.ticketId]
                  const label = localAt && t.status === 'valid' ? `Insläppt ${time(localAt)}` : t.status === 'checked_in' ? `Insläppt ${time(t.checkedInAt)}` : TICKET_LABEL[t.status]
                  return (
                    <tr key={t.ticketId}>
                      <td>{t.holderName || 'Namn saknas'}</td>
                      <td>{t.typeName}</td>
                      <td><span className="status-badge">{label}</span></td>
                      <td>
                        {t.status === 'valid' && !localAt ? (
                          <Button size="sm" variant="secondary" onClick={() => { void admit(t.ticketId, null) }}>Släpp in</Button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  )
}

/** occurrenceId = <eventId>-<YYYYMMDDTHHMMZ>: starten räcker för städningen dagen efter. */
function occurrenceEnd(occurrenceId: string): string {
  const m = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(occurrenceId)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : new Date().toISOString()
}
