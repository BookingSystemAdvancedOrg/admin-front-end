import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { clock } from './ordersApi'
import { OrderTableLink } from '../../shared/TableLinks'
import { orderTable, tableTitle } from '../../shared/tables'
import { byCourse, getRouting, isTabTicket, listTickets, printErrorText, reprintTicket, setTicketStatus, tabCourseText, TICKET_TEXT } from './printApi'
import type { Station, StationTicket } from './printApi'
import { SkelBlock, SkelBox } from '../../shared/Skeleton'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'

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
/** En FLYTTAD-lapp syns i tio minuter. */
const MOVE_SLIP_MS = 10 * 60_000

/** Källfiltret (?kalla=): alla bongar, bara bordsbeställningar eller bara onlinebeställningar. */
export type TicketSource = 'bord' | 'avhamtning'
const SOURCES: { id: TicketSource | null; label: string }[] = [
  { id: null, label: 'Alla' },
  { id: 'bord', label: 'Bord' },
  { id: 'avhamtning', label: 'Avhämtning' },
]

const VOID_TEXT: Record<string, string> = {
  wrong: 'Fel registrerad',
  guest_changed: 'Gästen ändrade sig',
  other: 'Annat',
}

/** Makuleringens skäl i klartext (voidReason från servern, äldre bongar i notes). */
function voidText(t: StationTicket): string | null {
  return VOID_TEXT[t.voidReason ?? ''] ?? VOID_TEXT[t.notes ?? ''] ?? null
}

/** Bongens bord; utan ritningen (labels null) det namn som står på bongen. */
function where(t: StationTicket, labels: Map<string, string> | null = null, tableId?: string): string {
  if (t.mode === 'table' || isTabTicket(t)) return tableTitle(orderTable(t.tableId ?? tableId, t.tableLabel, labels).label)
  return 'Avhämtning'
}

/** "Bord 5 · R2 · Anna · 18:42" eller "#12 Bord 5". */
function ticketName(t: StationTicket, labels: Map<string, string> | null = null, tableId?: string): string {
  return isTabTicket(t) ? `${where(t, labels, tableId)}, runda ${t.round ?? ''}` : `#${t.number ?? ''}, ${where(t, labels, tableId)}`
}

function key(t: StationTicket): string {
  return `${t.sourceId}/${t.stationId}`
}

export function KitchenDisplay({ locationId, station, onStation, labels = null, tableIds, date, source = null, onSource }: {
  locationId: string
  station: string | null
  onStation: (stationId: string) => void
  /** ?kalla=bord|avhamtning; null = alla. */
  source?: string | null
  onSource?: (source: TicketSource | null) => void
  /** Bordens nummer i den gällande ritningen (Layout). */
  labels?: Map<string, string> | null
  /** Beställningens bord per orderId (bongarna saknar bordets id). */
  tableIds?: Map<string, string>
  /** Dagen bordskartan ska visa. */
  date?: string
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
      setNotice(`Bongen för ${isTabTicket(ticket) ? where(ticket, labels) : `#${ticket.number ?? ''}`} skickad till ${ticket.stationName} igen.`)
    })
  }

  const list = stations ?? []
  const current = list.find((s) => s.stationId === station) ?? list[0]
  const now = fetchedAt
  const kind: TicketSource | null = source === 'bord' || source === 'avhamtning' ? source : null
  const fromSource = (t: StationTicket) => !kind || (kind === 'bord') === isTabTicket(t)
  const ofStation = (tickets ?? []).filter((t) => t.stationId === current?.stationId && t.status !== 'cancelled' && fromSource(t))
  // Flyttlappar är bara information: små kort överst i tio minuter (eller tills OK).
  const slips = ofStation.filter((t) => {
    const at = Date.parse(t.placedAt ?? t.createdAt ?? '')
    return t.kind === 'tab_move' && t.status !== 'ready' && (Number.isNaN(at) || now - at < MOVE_SLIP_MS)
  })
  const mine = ofStation.filter((t) => t.kind !== 'tab_move')
  const open = mine.filter((t) => t.status !== 'ready')
  const ready = mine.filter((t) => {
    const at = Date.parse(t.updatedAt ?? t.createdAt ?? '')
    return t.status === 'ready' && (Number.isNaN(at) || now - at < READY_KEEP_MS)
  })
  const count = (id?: string) => (tickets ?? []).filter((t) => t.stationId === id && t.kind !== 'tab_move' && fromSource(t) && (t.status === 'sent' || t.status === 'preparing')).length

  function card(t: StationTicket) {
    const isBusy = busy === key(t)
    const tableId = t.tableId ?? (t.orderId ? tableIds?.get(t.orderId) : undefined)
    const tab = isTabTicket(t)
    const voided = t.kind === 'tab_void'
    return (
      <article key={key(t)}
        className={`kds-ticket kds-ticket--${t.status}${t.allergy ? ' kds-ticket--allergy' : ''}${tab ? ' kds-ticket--tab' : ''}${voided ? ' kds-ticket--void' : ''}`}
        aria-label={`Bong ${ticketName(t, labels, tableId)}, ${voided ? 'makulerad' : TICKET_TEXT[t.status]}`}>
        <header className="kds-ticket-head">
          {tab ? <span className="order-number kds-round">R{t.round ?? ''}</span> : <span className="order-number">#{t.number ?? '-'}</span>}
          {t.mode === 'table' || tab ? (
            <OrderTableLink tableId={tableId} tableLabel={t.tableLabel} labels={labels} date={date}
              className="order-place order-place--table kds-place" iconSize={20} />
          ) : (
            <span className="order-place">Avhämtning</span>
          )}
          <span className="order-time">{clock(t.placedAt ?? t.createdAt)}</span>
        </header>
        {tab && (t.waiter || t.covers) ? (
          <p className="kds-tab-meta">
            {[t.waiter, t.covers ? `${t.covers} gäster` : null].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {voided && <p className="kds-void" role="note">MAKULERAD{voidText(t) ? `: ${voidText(t)}` : ''}</p>}
        {t.fire && <p className="kds-fire" role="note">SKICKA NU: {tabCourseText(t.fire).toUpperCase()}</p>}
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
        {t.waiting?.length ? (
          <p className="kds-waiting">Väntar: {t.waiting.map((w) => `${tabCourseText(w.course)} ${w.quantity}`).join(', ')}</p>
        ) : null}
        {t.notes && !(voided && VOID_TEXT[t.notes]) && <p className="order-notes">”{t.notes}”</p>}
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
      {onSource && (
        <div className="kds-sources" role="group" aria-label="Visa bongar från">
          {SOURCES.map((s) => (
            <button key={s.label} type="button" aria-pressed={kind === s.id} className={kind === s.id ? 'active' : ''}
              onClick={() => onSource(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <ErrorNote text={error} />
      {notice && <p className="save-notice" role="status">{notice}</p>}
      {slips.length > 0 && (
        <ul className="kds-slips" aria-label="Flyttade bord">
          {slips.map((t) => (
            <li key={key(t)} className="kds-slip">
              <span>
                <b>FLYTTAD</b> {tableTitle(t.fromLabel ?? '')} till {tableTitle(t.toLabel ?? t.tableLabel ?? '')}
                <span className="cell-muted"> · {clock(t.placedAt ?? t.createdAt)}{t.waiter ? ` · ${t.waiter}` : ''}</span>
              </span>
              <button type="button" className="btn outline square" disabled={busy === key(t)} onClick={() => move(t, 'ready')}>OK</button>
            </li>
          ))}
        </ul>
      )}
      {loadError && <ErrorNote text={booqyFaultText('Bongarna kunde inte visas.')} />}
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
          <p className="kds-paper-big">
            {isTabTicket(printing) ? where(printing).toUpperCase() : `#${printing.number ?? '-'} ${where(printing)}`}
          </p>
          {printing.kind === 'tab_void' && <p className="kds-paper-big">MAKULERAD</p>}
          {printing.fire && <p className="kds-paper-big">SKICKA NU: {tabCourseText(printing.fire).toUpperCase()}</p>}
          {printing.allergy && <p className="kds-paper-big">!! ALLERGI !!</p>}
          <p>
            {isTabTicket(printing)
              ? [`Runda ${printing.round ?? ''}`, printing.waiter, clock(printing.placedAt ?? printing.createdAt), printing.covers ? `${printing.covers} gäster` : null].filter(Boolean).join(' · ')
              : `Beställd ${clock(printing.placedAt ?? printing.createdAt)}`}
          </p>
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
          {printing.waiting?.length ? (
            <p>Väntar: {printing.waiting.map((w) => `${tabCourseText(w.course)} ${w.quantity}`).join(', ')}</p>
          ) : null}
          {printing.kind === 'tab_void' && voidText(printing) && <p>{voidText(printing)}</p>}
          {printing.notes && !(printing.kind === 'tab_void' && VOID_TEXT[printing.notes]) && <p><b>NOTERING: {printing.notes}</b></p>}
        </div>
      )}
    </div>
  )
}
