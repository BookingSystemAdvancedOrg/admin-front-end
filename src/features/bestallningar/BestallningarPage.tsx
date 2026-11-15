import { useLiveRefresh } from '../../shared/live'
import { errorText } from '../../shared/errors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StatTile } from '../../shared/motion/StatTile'
import { Num } from '../../shared/motion/Num'
import { clockIn, revenueToday, revenueUntil } from '../oversikt/overview'
import { addDays } from '../statistik/stats'
import { trendOf } from '../../shared/trend'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useLocationId } from '../../shared/location'
import { useAuth } from '../auth/useAuth'
import {
  clock,
  closedText,
  kronor,
  listOrders,
  moveErrorText,
  moveOrder,
  pauseOrdering,
} from './ordersApi'
import type { Order, OrderingState, StaffMove } from './ordersApi'
import { tableTitle } from '../table-qr/tableQrApi'
import { getPrintStatus, printBannerText, printErrorText, reprintOrder, TICKET_TEXT } from './printApi'
import type { JobState, PrintStatus } from './printApi'
import { KitchenDisplay } from './KitchenDisplay'
import './bestallningar.css'
import { SkelBlock, SkelBox, SkelPage, SkelTiles } from '../../shared/Skeleton'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'
import { Select } from '../../shared/Select'

/** Hur ofta listan hämtas om (köksskärmen står öppen hela kvällen). */
export const POLL_MS = 10_000
const PAUSE_CHOICES = [15, 30, 60, 120]

const COLUMNS: { status: Order['status']; title: string; empty: string }[] = [
  { status: 'confirmed', title: 'Nya', empty: 'Inga nya.' },
  { status: 'preparing', title: 'Tillagas', empty: 'Inget tillagas.' },
  { status: 'ready', title: 'Klara', empty: 'Inget klart.' },
]

const JOB_TEXT: Record<JobState, string> = {
  PENDING: 'Ej utskriven',
  PRINTING: 'Skrivs ut',
  FAILED: 'Utskrift misslyckades',
}

function where(order: Order): string {
  return order.mode === 'table' ? tableTitle(order.tableLabel ?? '?') : 'Avhämtning'
}

/** Filtrets värde för en beställning: bordets id (eller namn), "pickup" för avhämtning. */
function placeKey(order: Order): string {
  return order.mode === 'table' ? `table:${order.tableId ?? order.tableLabel ?? '?'}` : 'pickup'
}

const ALL = 'all'

/**
 * Köksskärmen för matbeställningar: dagens betalda beställningar i
 * tre kolumner (Nya, Tillagas, Klara). Två klick per beställning:
 * "Påbörja" skickar gästens bekräftelse-sms (restaurangen har börjat, klar
 * ca HH:MM räknat från klicket) och "Klar" på en avhämtning skickar sms:et
 * att den kan hämtas. "Avbryt" återbetalar via Stripe (bekräftas i två
 * steg). Listan hämtas om var tionde sekund; nya beställningar markeras.
 */
export default function BestallningarPage() {
  const { sub } = useAuth()
  const { locationId, resolving } = useLocationId(sub)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [ordering, setOrdering] = useState<OrderingState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const seen = useRef<Set<string> | null>(null)
  const [print, setPrint] = useState<PrintStatus | null>(null)
  /** Listans datum (platsens dag) och samma veckodag förra veckan, för omsättningens jämförelse. */
  const [listDate, setListDate] = useState<string | null>(null)
  const [lastWeek, setLastWeek] = useState<{ key: string; orders: Order[] } | null>(null)
  const [printNotice, setPrintNotice] = useState<string | null>(null)
  /** Vilket bord (eller avhämtning) tavlan visar; "all" = alla. */
  const [place, setPlace] = useState(ALL)
  /** Efter "Klar att servera": vilket bord maten ska till, stort överst. */
  const [serveTo, setServeTo] = useState<Order | null>(null)
  /** Skärmläsarens besked om nya beställningar ("Ny beställning #12, Bord 7"). */
  const [announce, setAnnounce] = useState('')
  /** ?vy=kok: köksskärmen (en stations bongar) i stället för tavlan; ?station= vilken. */
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search))
  const kds = params.get('vy') === 'kok'
  function view(next: { vy?: string | null; station?: string | null }) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    const query = p.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    setParams(p)
  }

  const refresh = useCallback(async () => {
    if (!locationId) return
    try {
      const list = await listOrders(locationId)
      const ids = new Set(list.orders.map((o) => o.orderId))
      if (seen.current) {
        const added = list.orders.filter((o) => !seen.current!.has(o.orderId))
        if (added.length) {
          setFresh((prev) => new Set([...prev, ...added.map((o) => o.orderId)]))
          setAnnounce(added.map((o) => `Ny beställning #${o.number ?? ''}, ${where(o)}`).join('. '))
        }
      }
      seen.current = ids
      setOrders(list.orders)
      setOrdering(list.ordering)
      setListDate(list.date)
      setLoadError(false)
    } catch {
      setLoadError(true)
      return false
    }
    // Skrivarens läge är en bonus: om det inte går att hämta visas ingen skrivarrad.
    getPrintStatus(locationId).then(setPrint).catch(() => setPrint(null))
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    void refresh()
  }, [locationId, refresh])
  // Levande: var tionde sekund medan fliken syns, direkt vid fokus och efter egna ändringar.
  useLiveRefresh(refresh, { enabled: Boolean(locationId), everyMs: POLL_MS })

  // Förra veckans dag hämtas en gång per dag, inte var tionde sekund.
  useEffect(() => {
    if (!locationId || !listDate) return
    let cancelled = false
    listOrders(locationId, addDays(listDate, -7))
      .then((l) => !cancelled && setLastWeek({ key: `${locationId}|${listDate}`, orders: l.orders }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [locationId, listDate])

  const newCount = (orders ?? []).filter((o) => o.status === 'confirmed').length
  useEffect(() => {
    const before = document.title
    document.title = newCount ? `(${newCount}) Beställningar` : 'Beställningar'
    return () => {
      document.title = before
    }
  }, [newCount])

  async function move(order: Order, status: StaffMove) {
    if (!locationId) return
    setBusy(order.orderId)
    setActionError(null)
    try {
      const updated = await moveOrder(locationId, order, status)
      if (updated.mode === 'table' && status === 'ready') setServeTo(updated)
      else if (serveTo?.orderId === updated.orderId) setServeTo(null)
      setOrders((prev) => (prev ?? []).map((o) => (o.orderId === updated.orderId ? updated : o)))
      setFresh((prev) => {
        const next = new Set(prev)
        next.delete(order.orderId)
        return next
      })
    } catch (err) {
      setActionError(moveErrorText(err))
      void refresh()
    } finally {
      setBusy(null)
      setConfirmCancel(null)
    }
  }

  async function reprint(order: Order) {
    if (!locationId) return
    setBusy(order.orderId)
    setActionError(null)
    setPrintNotice(null)
    try {
      await reprintOrder(locationId, order.orderId)
      setPrintNotice(`#${order.number ?? ''} skickad till skrivaren igen.`)
      void getPrintStatus(locationId).then(setPrint).catch(() => undefined)
    } catch (err) {
      setActionError(printErrorText(err))
    } finally {
      setBusy(null)
    }
  }

  async function pause(minutes: number) {
    if (!locationId) return
    setActionError(null)
    try {
      const result = await pauseOrdering(locationId, minutes)
      setOrdering(result.ordering)
    } catch (err) {
      setActionError(errorText(err, 'Kunde inte ändra pausen just nu.'))
    }
  }

  // Filtret: borden (och avhämtning) som finns bland dagens beställningar.
  const places = new Map<string, string>()
  for (const o of orders ?? []) places.set(placeKey(o), where(o))
  const placeOptions = [...places].sort((a, b) =>
    a[0] === 'pickup' ? -1 : b[0] === 'pickup' ? 1 : a[1].localeCompare(b[1], 'sv', { numeric: true }),
  )
  const placeValue = places.has(place) ? place : ALL
  const shown = (orders ?? []).filter((o) => placeValue === ALL || placeKey(o) === placeValue)
  const active = shown.filter((o) => ['confirmed', 'preparing', 'ready'].includes(o.status))
  const done = shown.filter((o) => o.status === 'completed' || o.status === 'cancelled')
  const paused = ordering?.reason === 'paused'
  const revenue = revenueToday(orders)
  const lastWeekOrders = lastWeek?.key === `${locationId}|${listDate}` ? lastWeek.orders : null
  // Restaurangerna ligger i Europe/Stockholm (clockIn faller tillbaka dit).
  const revenueBefore = revenueUntil(lastWeekOrders, clockIn(null), null)
  const count = (status: string) => active.filter((o) => o.status === status).length
  const tiles = [
    { label: 'Nya', value: String(count('confirmed')), tone: count('confirmed') ? ('attention' as const) : undefined },
    { label: 'Tillagas', value: String(count('preparing')) },
    { label: 'Klara', value: String(count('ready')) },
    {
      label: 'Omsättning idag',
      value: revenue ? kronor(revenue.amount) : '-',
      trend: revenue ? trendOf(revenue.amount, revenueBefore, 'revenue', 'samma tid förra veckan') : undefined,
    },
  ]

  const pauseControls = (
    <div className="orders-pause" data-tour="orders-pause">
      {paused ? (
        <button type="button" className="btn outline square" onClick={() => void pause(0)}>
          Ta emot beställningar igen
        </button>
      ) : (
        <>
          <label htmlFor="orders-pause">Pausa beställningar</label>
          <Select
            id="orders-pause"
            value=""
            disabled={!ordering?.open}
            onChange={(e) => e.target.value && void pause(Number(e.target.value))}
          >
            <option value="">Välj…</option>
            {PAUSE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </Select>
        </>
      )}
    </div>
  )

  function card(order: Order) {
    const isBusy = busy === order.orderId
    const confirming = confirmCancel === order.orderId
    const stations = print?.tickets?.[order.orderId] ?? []
    return (
      <article
        key={order.orderId}
        className={`order-card${fresh.has(order.orderId) ? ' fresh' : ''}`}
        aria-label={`Beställning ${order.number ?? ''}, ${where(order)}`}
      >
        <header className="order-card-head">
          <span className="order-number">#{order.number ?? '-'}</span>
          <span className={order.mode === 'table' ? 'order-place order-place--table' : 'order-place'}>
            {where(order)}
          </span>
          <span className="order-time" title="Betald">
            {clock(order.confirmedAt)}
          </span>
        </header>
        {order.mode === 'table' && order.status === 'ready' && (
          <p className="order-serve-to">Bär till {where(order)}</p>
        )}
        {print?.orders[order.orderId] && (
          <span className={`status-badge order-print ${print.orders[order.orderId] === 'FAILED' ? 'cancelled' : 'waiting'}`}>
            {JOB_TEXT[print.orders[order.orderId]]}
          </span>
        )}
        {stations.length > 0 && (
          <ul className="order-stations" aria-label="Bongar per station">
            {stations.map((st) => (
              <li key={st.stationId} className={`order-station order-station--${st.status}`}>
                {st.stationName}: {TICKET_TEXT[st.status]}
              </li>
            ))}
          </ul>
        )}
        <ul className="order-lines">
          {order.lines.map((line, i) => (
            <li key={`${line.menuItemId}-${i}`}>
              <strong>{line.quantity} ×</strong> {line.name}
              {line.options?.map((o) => (
                <span key={`${o.group}-${o.choice}`} className="order-line-note">+ {o.group}: {o.choice}</span>
              ))}
              {line.note && <span className="order-line-note">{line.note}</span>}
              {line.allergy && <span className="order-line-allergy">Allergi: {line.allergy}</span>}
            </li>
          ))}
        </ul>
        {order.notes && <p className="order-notes">”{order.notes}”</p>}
        <p className="order-meta cell-muted">
          {order.customerName}
          {order.customerPhone ? ` · ${order.customerPhone}` : ''} · <Num>{kronor(order.totalAmount)}</Num>
          {order.discount ? ` (rabatt ${order.discount.percent} %, kod ${order.discount.code})` : ''}
          {order.mode === 'pickup' && order.status !== 'ready' && order.readyEstimate
            ? ` · lovad ca ${clock(order.readyEstimate)}`
            : ''}
        </p>
        <div className="order-actions">
          {order.status === 'confirmed' && (
            <button type="button" className="btn primary square" disabled={isBusy}
              onClick={() => void move(order, 'preparing')}>
              Påbörja - skicka sms
            </button>
          )}
          {order.status === 'preparing' && (
            <button type="button" className="btn primary square" disabled={isBusy}
              onClick={() => void move(order, 'ready')}>
              {order.mode === 'pickup' ? 'Klar - skicka sms' : 'Klar att servera'}
            </button>
          )}
          {order.status === 'ready' && (
            <button type="button" className="btn primary square" disabled={isBusy}
              onClick={() => void move(order, 'completed')}>
              {order.mode === 'pickup' ? 'Hämtad' : `Serverad vid ${where(order)}`}
            </button>
          )}
          {(print?.printerConfigured || stations.length > 0) && !confirming && order.status !== 'cancelled' && (
            <button type="button" className="btn outline square" disabled={isBusy}
              onClick={() => void reprint(order)}>
              Skriv ut igen
            </button>
          )}
          {confirming ? (
            <>
              <button type="button" className="btn danger-outline square" disabled={isBusy}
                onClick={() => void move(order, 'cancelled')}>
                Bekräfta: avbryt och återbetala {kronor(order.totalAmount)}
              </button>
              <button type="button" className="btn outline square" onClick={() => setConfirmCancel(null)}>
                Behåll
              </button>
            </>
          ) : (
            <button type="button" className="btn outline square order-cancel" disabled={isBusy}
              onClick={() => setConfirmCancel(order.orderId)}>
              Avbryt
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <>
      <AdminTopbar title="Beställningar" actions={ordering ? pauseControls : undefined} />
      <div className="admin-main">
        {!locationId ? (
          resolving ? (
            <SkelPage label="Hämtar platsen">
              <SkelTiles />
              <OrdersBoardSkeleton />
            </SkelPage>
          ) : <p className="cell-muted">Ingen plats vald.</p>
        ) : (
          <>
            {ordering && !ordering.open && (
              <p className={paused ? 'orders-banner paused' : 'orders-banner'} role="status">
                {closedText(ordering)}
              </p>
            )}
            {ordering?.open && (
              <p className="orders-banner open" role="status">
                Tar emot beställningar
                {ordering.lastOrderAt ? ` · sista beställning ${ordering.lastOrderAt}` : ''}
                {ordering.prepMinutes ? ` · ca ${ordering.prepMinutes} min` : ''}
              </p>
            )}
            {printBannerText(print) && (
              <p className={print?.online ? 'orders-banner' : 'orders-banner paused'} role="status">
                {printBannerText(print)}
              </p>
            )}
            {printNotice && (
              <p className="save-notice" role="status">
                {printNotice}
              </p>
            )}
            {actionError && (
              <ErrorNote text={actionError} />
            )}
            {loadError && (
              <ErrorNote text={booqyFaultText('Kunde inte hämta beställningarna. Sidan försöker igen av sig själv.')} />
            )}
            <section className="stats-row" aria-label="Dagens siffror">
              {tiles.map((t, i) => (
                <StatTile key={t.label} {...t} loading={orders === null} index={i} />
              ))}
            </section>
            {serveTo && (
              <div className="orders-serve" role="status">
                <span>
                  #{serveTo.number ?? ''} är klar. Bär maten till
                  <strong className="orders-serve-table">{where(serveTo)}</strong>
                </span>
                <button type="button" className="btn outline square" onClick={() => setServeTo(null)}>
                  OK
                </button>
              </div>
            )}
            <p className="sr-only" aria-live="polite">{announce}</p>
            <div className="orders-views" role="tablist" aria-label="Vy">
              <button type="button" role="tab" aria-selected={!kds} className={!kds ? 'active' : ''}
                onClick={() => view({ vy: null })}>
                Alla beställningar
              </button>
              <button type="button" role="tab" aria-selected={kds} className={kds ? 'active' : ''}
                onClick={() => view({ vy: 'kok' })}>
                Köksskärm
              </button>
            </div>
            {kds ? (
              <KitchenDisplay locationId={locationId} station={params.get('station')}
                onStation={(station) => view({ station })} />
            ) : <>
            {placeOptions.length > 1 && (
              <div className="orders-filter">
                <label htmlFor="orders-place">Visa</label>
                <Select id="orders-place" value={placeValue} onChange={(e) => setPlace(e.target.value)}>
                  <option value={ALL}>Alla bord och avhämtning</option>
                  {placeOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </Select>
                {placeValue !== ALL && (
                  <button type="button" className="btn outline square" onClick={() => setPlace(ALL)}>
                    Visa alla
                  </button>
                )}
              </div>
            )}
            {orders === null && !loadError ? (
              <SkelPage label="Hämtar beställningar">
                <OrdersBoardSkeleton />
              </SkelPage>
            ) : (
              <div className="orders-board" data-tour="orders-board">
                {COLUMNS.map((column) => {
                  const items = active.filter((o) => o.status === column.status)
                  return (
                    <section key={column.status} className="orders-column" aria-label={column.title}>
                      <h2 className="orders-column-title">
                        {column.title} <span className="cell-muted"><Num>{items.length}</Num></span>
                      </h2>
                      {items.length ? items.map(card) : <p className="cell-muted">{column.empty}</p>}
                    </section>
                  )
                })}
              </div>
            )}
            {done.length > 0 && (
              <details className="admin-card orders-done">
                <summary>
                  Avslutade idag ({done.length})
                </summary>
                <ul>
                  {done.map((o) => (
                    <li key={o.orderId}>
                      #{o.number} · {where(o)} · {o.customerName} · <Num>{kronor(o.totalAmount)}</Num> ·{' '}
                      {o.status === 'cancelled' ? 'Avbruten, återbetald' : `Klar ${clock(o.completedAt)}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            </>}
          </>
        )}
      </div>
    </>
  )
}

/** Medan beställningarna hämtas: tavlans tre kolumner med suddiga lappar. */
function OrdersBoardSkeleton() {
  return (
    <div className="orders-board" aria-hidden="true">
      {COLUMNS.map((column) => (
        <section key={column.status} className="orders-column">
          <SkelBlock w={110} h={20} />
          {[0, 1].map((i) => (
            <SkelBox key={i} className="order-card" h={118}>
              <SkelBlock w="40%" h={16} />
              <SkelBlock w="80%" />
              <SkelBlock w="60%" />
            </SkelBox>
          ))}
        </section>
      ))}
    </div>
  )
}
