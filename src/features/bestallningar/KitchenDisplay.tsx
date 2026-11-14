import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { clock } from './ordersApi'
import { tableTitle } from '../table-qr/tableQrApi'
import { byCourse, getRouting, listTickets, printErrorText, reprintTicket, setTicketStatus, TICKET_TEXT } from './printApi'
import type { Station, StationTicket } from './printApi'
import { SkelBlock, SkelBox } from '../../shared/Skeleton'

/**
 * Köksskärmen (KDS): varje stations bongar på skärmen, samma som skrivaren
 * skriver ut. Fungerar utan skrivare och som reserv när en skrivare inte
 * svarar. "Påbörja" och "Klar" syns på Beställningar som stationens läge;
 * "Skriv ut" skickar bongen till stationens skrivare igen och "Skriv ut
 * här" använder webbläsarens utskrift som sista utväg. Hämtas var femte
 * sekund. Klara bongar ligger kvar en kvart under Klara.
 */

export const KDS_POLL_MS = 5_000
const READY_KEEP_MS = 15 * 60_000

function where(t: StationTicket): string {
  if (t.mode === 'table') return tableTitle(t.tableLabel ?? '?')
  return 'Avhämtning'
}

function key(t: StationTicket): string {
  return `${t.sourceId}/${t.stationId}`
}

export function KitchenDisplay({ locationId, station, onStation }: {
  locationId: string
  station: string | null
  onStation: (stationId: string) => void
}) {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [tickets, setTickets] = useState<StationTicket[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [printing, setPrinting] = useState<StationTicket | null>(null)
  /** När listan hämtades: klara bongar ligger kvar en kvart räknat härifrån. */
  const [fetchedAt, setFetchedAt] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setTickets(await listTickets(locationId))
      setFetchedAt(Date.now())
      setLoadError(false)
    } catch {
      setLoadError(true)
      return false
    }
  }, [locationId])

  useEffect(() => {
    getRouting(locationId).then((r) => setStations(r.stations)).catch(() => setStations([]))
    void refresh()
  }, [locationId, refresh])
  // Levande: var femte sekund medan skärmen syns, direkt vid fokus och efter egna ändringar.
  useLiveRefresh(refresh, { everyMs: KDS_POLL_MS })

  // Webbläsarens utskrift: bara bongen syns på papperet (bestallningar.css @media print).
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done)
    const timer = window.setTimeout(() => window.print(), 50)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', done)
    }
  }, [printing])

  async function act(ticket: StationTicket, run: () => Promise<void>) {
    setBusy(key(ticket))
    setError(null)
    setNotice(null)
    try {
      await run()
    } catch (err) {
      setError(printErrorText(err))
      void refresh()
    } finally {
      setBusy(null)
    }
  }

  function move(ticket: StationTicket, status: 'preparing' | 'ready' | 'sent') {
    void act(ticket, async () => {
      const next = await setTicketStatus(locationId, ticket, status)
      setTickets((prev) => (prev ?? []).map((t) => (key(t) === key(ticket) ? { ...t, ...next } : t)))
    })
  }

  function reprint(ticket: StationTicket) {
    void act(ticket, async () => {
      await reprintTicket(locationId, ticket)
      setNotice(`Bongen för #${ticket.number ?? ''} skickad till ${ticket.stationName} igen.`)
    })
  }

  const list = stations ?? []
  const current = list.find((s) => s.stationId === station) ?? list[0]
  const now = fetchedAt
  const mine = (tickets ?? []).filter((t) => t.stationId === current?.stationId && t.status !== 'cancelled')
  const open = mine.filter((t) => t.status !== 'ready')
  const ready = mine.filter((t) => {
    const at = Date.parse(t.updatedAt ?? t.createdAt ?? '')
    return t.status === 'ready' && (Number.isNaN(at) || now - at < READY_KEEP_MS)
  })
  const count = (id?: string) => (tickets ?? []).filter((t) => t.stationId === id && (t.status === 'sent' || t.status === 'preparing')).length

  function card(t: StationTicket) {
    const isBusy = busy === key(t)
    return (
      <article key={key(t)} className={`kds-ticket kds-ticket--${t.status}${t.allergy ? ' kds-ticket--allergy' : ''}`}
        aria-label={`Bong #${t.number ?? ''}, ${where(t)}, ${TICKET_TEXT[t.status]}`}>
        <header className="kds-ticket-head">
          <span className="order-number">#{t.number ?? '-'}</span>
          <span className={t.mode === 'table' ? 'order-place order-place--table' : 'order-place'}>{where(t)}</span>
          <span className="order-time">{clock(t.placedAt ?? t.createdAt)}</span>
        </header>
        {t.allergy && <p className="kds-allergy" role="note">Allergi: kontrollera innan maten går ut</p>}
        {byCourse(t.entries).map((group) => (
          <div key={group.course ?? 'all'} className="kds-course">
            {group.course && <p className="kds-course-title">{group.course}</p>}
            <ul className="kds-lines">
              {group.entries.map((e, i) => (
                <li key={i}>
                  <strong>{e.quantity} ×</strong> {e.name}
                  {e.partOf && <span className="cell-muted"> ({e.partOf})</span>}
                  {e.options?.map((o) => <span key={o} className="kds-note">+ {o}</span>)}
                  {e.note && <span className="kds-note">{e.note}</span>}
                  {e.allergy && <span className="kds-line-allergy">Allergi: {e.allergy}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {t.notes && <p className="order-notes">”{t.notes}”</p>}
        <div className="order-actions">
          {t.status === 'sent' && (
            <button type="button" className="btn primary square" disabled={isBusy} onClick={() => move(t, 'preparing')}>Påbörja</button>
          )}
          {t.status === 'preparing' && (
            <button type="button" className="btn primary square" disabled={isBusy} onClick={() => move(t, 'ready')}>Klar</button>
          )}
          {t.status === 'ready' && (
            <button type="button" className="btn outline square" disabled={isBusy} onClick={() => move(t, 'preparing')}>Ångra klar</button>
          )}
          <button type="button" className="btn outline square" disabled={isBusy} onClick={() => reprint(t)}>Skriv ut</button>
          <button type="button" className="btn outline square" onClick={() => setPrinting(t)}>Skriv ut här</button>
        </div>
      </article>
    )
  }

  return (
    <div className="kds">
      {list.length > 1 && (
        <div className="kds-stations" role="tablist" aria-label="Station">
          {list.map((s) => (
            <button key={s.stationId} type="button" role="tab" aria-selected={s.stationId === current?.stationId}
              className={s.stationId === current?.stationId ? 'active' : ''} onClick={() => onStation(s.stationId!)}>
              {s.name} <span className="kds-count">{count(s.stationId)}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="save-notice" role="status">{notice}</p>}
      {loadError && <p className="form-error" role="alert">Kunde inte hämta bongarna. Försöker igen…</p>}
      {tickets === null || stations === null ? (
        <div className="kds-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <SkelBox key={i} className="kds-ticket" h={180}>
              <SkelBlock w="40%" h={16} />
              <SkelBlock w="80%" />
              <SkelBlock w="60%" />
            </SkelBox>
          ))}
        </div>
      ) : (
        <>
          <h2 className="orders-column-title">{current?.name ?? 'Bongar'} <span className="cell-muted">{open.length}</span></h2>
          {open.length ? <div className="kds-grid">{open.map(card)}</div> : <p className="cell-muted">Inga bongar just nu.</p>}
          {ready.length > 0 && (
            <>
              <h2 className="orders-column-title">Klara <span className="cell-muted">{ready.length}</span></h2>
              <div className="kds-grid">{ready.map(card)}</div>
            </>
          )}
        </>
      )}
      {printing && (
        <div className="kds-paper" aria-hidden="true">
          <p>{printing.stationName.toUpperCase()}</p>
          <p className="kds-paper-big">#{printing.number ?? '-'} {where(printing)}</p>
          {printing.allergy && <p className="kds-paper-big">!! ALLERGI !!</p>}
          <p>Beställd {clock(printing.placedAt ?? printing.createdAt)}</p>
          {byCourse(printing.entries).map((g) => (
            <div key={g.course ?? 'all'}>
              {g.course && <p>-- {g.course.toUpperCase()} --</p>}
              {g.entries.map((e, i) => (
                <p key={i}>
                  <b>{e.quantity} x {e.name}</b>
                  {e.partOf ? ` (${e.partOf})` : ''}
                  {e.options?.map((o) => <span key={o}><br /><b>+ {o}</b></span>)}
                  {e.note && <><br /><b>{e.note}</b></>}
                  {e.allergy && <><br /><b>ALLERGI: {e.allergy}</b></>}
                </p>
              ))}
            </div>
          ))}
          {printing.notes && <p><b>NOTERING: {printing.notes}</b></p>}
        </div>
      )}
    </div>
  )
}
