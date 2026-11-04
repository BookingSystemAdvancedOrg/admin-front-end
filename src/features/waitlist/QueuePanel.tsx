import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Modal, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { SlotTablePicker, type SlotValue } from '../bokningar/SlotTablePicker'
import {
  ERRORS,
  STATUS_LABEL,
  addWalkIn,
  clock,
  getQueue,
  newEntryId,
  offerTable,
  removeEntry,
  seatNow,
  type Entry,
  type Queue,
} from './api'
import './waitlist.css'

const REFRESH_MS = 30_000

/** Bokningar > Kö: dagens kö, förslag när ett bord är ledigt, erbjud, placera och ta bort. */
export default function QueuePanel({ locationId, date }: { locationId: string; date: string }) {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [picking, setPicking] = useState<{ entry: Entry; mode: 'offer' | 'seat' } | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      setQueue(await getQueue(locationId, date))
    } catch {
      setQueue(null)
    }
  }, [locationId, date])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [load])

  async function run(id: string, fn: () => Promise<unknown>, fallback: string) {
    setBusy(id)
    try {
      await fn()
      await load()
    } catch (err) {
      toast(errorText(err, fallback, ERRORS), { tone: 'danger' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (!queue) return null
  const open = queue.entries.filter((e) => e.status === 'waiting' || e.status === 'offered')
  const waiting = open.filter((e) => e.status === 'waiting').length
  const byId = new Map(queue.entries.map((e) => [e.entryId, e]))
  const first = queue.suggestions[0]
  const firstEntry = first ? byId.get(first.entryId) : undefined

  return (
    <Card title={<>Kö <span className="status-badge" aria-label={`${waiting} väntar`}>{waiting}</span></>}
      actions={<Button size="sm" onClick={() => setAdding(true)}>Ställ i kö</Button>}>
      {!queue.settings.enabled ? (
        <p className="cell-muted">Kön är avstängd. Ägaren slår på den under Inställningar &gt; Bord.</p>
      ) : null}
      {first && firstEntry ? (
        <Bar variant="banner" tone="info" action={
          <Button size="sm" busy={busy === `offer-${first.entryId}`}
            onClick={() => void run(`offer-${first.entryId}`, () => offerTable(locationId, firstEntry, first.tableIds, first.startTime), 'Kunde inte erbjuda bordet.')}>
            Erbjud bord
          </Button>
        }>
          Bord {first.tableIds.join(', ')} är ledigt för {firstEntry.name}, {firstEntry.partySize} pers.
        </Bar>
      ) : null}
      {open.length === 0 ? <p className="admin-empty">Ingen står i kö just nu.</p> : (
        <ol className="queue-list">
          {open.map((e) => (
            <li key={e.entryId} className="queue-row">
              <div className="queue-who">
                <strong>{e.position ? `${e.position}. ` : ''}{e.name}</strong>
                <span className="cell-muted">{e.partySize} pers. · i kö sedan {clock(e.joinedAt)}{e.source === 'site' ? ' · från hemsidan' : ''}</span>
                {e.note ? <span className="cell-muted">{e.note}</span> : null}
                <span>
                  <span className="status-badge">{STATUS_LABEL[e.status]}</span>
                  {e.offer && e.status === 'offered' ? <span className="cell-muted"> Bord {e.offer.tableIds.join(', ')} kl. {e.offer.startTime}, svar senast {clock(e.offer.expiresAt)}</span> : null}
                  {e.notice && !e.notice.sentAt ? <span className="queue-warn"> Sms ej skickat</span> : null}
                  {!e.phone ? <span className="cell-muted"> Inget nummer, säg till gästen själv.</span> : null}
                </span>
              </div>
              <Bar variant="action" label={`Kö: ${e.name}`}>
                {e.status === 'waiting' ? (
                  <Button size="sm" variant="secondary" onClick={() => setPicking({ entry: e, mode: 'offer' })}>Erbjud bord</Button>
                ) : null}
                <Button size="sm" busy={busy === `seat-${e.entryId}`}
                  onClick={() => (e.status === 'offered'
                    ? void run(`seat-${e.entryId}`, () => seatNow(locationId, e), 'Kunde inte placera gästen.')
                    : setPicking({ entry: e, mode: 'seat' }))}>
                  Placera nu
                </Button>
                <Button size="sm" variant="ghost" busy={busy === `remove-${e.entryId}`}
                  onClick={() => void run(`remove-${e.entryId}`, () => removeEntry(locationId, e), 'Kunde inte ta bort.')}>
                  Ta bort
                </Button>
              </Bar>
            </li>
          ))}
        </ol>
      )}
      {picking ? (
        <TablePickModal locationId={locationId} date={date} entry={picking.entry} mode={picking.mode}
          onClose={() => setPicking(null)}
          onPicked={(v) => {
            const { entry, mode } = picking
            setPicking(null)
            void run(`${mode}-${entry.entryId}`, () => (mode === 'offer'
              ? offerTable(locationId, entry, v.tableIds, v.startTime)
              : seatNow(locationId, entry, v.tableIds)), 'Det gick inte.')
          }} />
      ) : null}
      {adding ? <WalkInModal locationId={locationId} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); void load() }} /> : null}
    </Card>
  )
}

function TablePickModal({ locationId, date, entry, mode, onClose, onPicked }: {
  locationId: string; date: string; entry: Entry; mode: 'offer' | 'seat'
  onClose: () => void; onPicked: (v: SlotValue) => void
}) {
  const [value, setValue] = useState<SlotValue>({ date, startTime: '', tableIds: [] })
  return (
    <Modal open title={mode === 'offer' ? `Erbjud bord till ${entry.name}` : `Placera ${entry.name}`} onClose={onClose}
      footer={
        <Bar variant="action" label="Välj bord">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button disabled={!value.startTime || value.tableIds.length === 0} onClick={() => onPicked(value)}>
            {mode === 'offer' ? 'Erbjud' : 'Placera'}
          </Button>
        </Bar>
      }>
      <SlotTablePicker locationId={locationId} date={date} today={date} startTime={value.startTime}
        tableIds={value.tableIds} partySize={entry.partySize} walkIn onChange={setValue} />
    </Modal>
  )
}

function WalkInModal({ locationId, onClose, onAdded }: { locationId: string; onClose: () => void; onAdded: () => void }) {
  const [entryId] = useState(newEntryId)
  const [name, setName] = useState('')
  const [party, setParty] = useState('2')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await addWalkIn(locationId, { entryId, name: name.trim(), partySize: Number(party), ...(phone.trim() ? { phone: phone.trim() } : {}) })
      toast(`${name.trim()} står i kö.`, { tone: 'success' })
      onAdded()
    } catch (err) {
      toast(errorText(err, 'Kunde inte ställa gästen i kö.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title="Ställ i kö" onClose={onClose}>
      <form className="form-grid" onSubmit={save} aria-label="Ställ i kö">
        <Field label="Namn" required><Input value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Antal gäster" required>
          <Input type="number" min={1} max={20} value={party} required onChange={(e) => setParty(e.target.value)} />
        </Field>
        <Field label="Mobilnummer" hint="Gästen får ett sms när bordet är klart. Utan nummer säger ni till själva.">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Bar variant="action" label="Ställ i kö">
          <Button type="button" variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button type="submit" busy={saving} busyLabel="Sparar…" disabled={!name.trim()}>Ställ i kö</Button>
        </Bar>
      </form>
    </Modal>
  )
}
