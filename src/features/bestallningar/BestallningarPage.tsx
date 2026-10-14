import { useCallback, useEffect, useRef, useState } from 'react'
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
import './bestallningar.css'

/** Hur ofta listan hämtas om (köksskärmen står öppen hela kvällen). */
export const POLL_MS = 10_000
const PAUSE_CHOICES = [15, 30, 60, 120]

const COLUMNS: { status: Order['status']; title: string; empty: string }[] = [
  { status: 'confirmed', title: 'Nya', empty: 'Inga nya beställningar.' },
  { status: 'preparing', title: 'Tillagas', empty: 'Inget tillagas just nu.' },
  { status: 'ready', title: 'Klara', empty: 'Inget väntar på att hämtas eller serveras.' },
]

function where(order: Order): string {
  if (order.mode === 'table') {
    const label = order.tableLabel ?? '?'
    return /^bord/i.test(label) ? label : `Bord ${label}`
  }
  return 'Avhämtning'
}

/**
 * Köks-/kassaskärmen för matbeställningar: dagens betalda beställningar i
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

  const refresh = useCallback(async () => {
    if (!locationId) return
    try {
      const list = await listOrders(locationId)
      const ids = new Set(list.orders.map((o) => o.orderId))
      if (seen.current) {
        const added = list.orders.filter((o) => !seen.current!.has(o.orderId)).map((o) => o.orderId)
        if (added.length) setFresh((prev) => new Set([...prev, ...added]))
      }
      seen.current = ids
      setOrders(list.orders)
      setOrdering(list.ordering)
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [locationId, refresh])

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

  async function pause(minutes: number) {
    if (!locationId) return
    setActionError(null)
    try {
      const result = await pauseOrdering(locationId, minutes)
      setOrdering(result.ordering)
    } catch {
      setActionError('Kunde inte ändra pausen just nu.')
    }
  }

  const active = (orders ?? []).filter((o) => ['confirmed', 'preparing', 'ready'].includes(o.status))
  const done = (orders ?? []).filter((o) => o.status === 'completed' || o.status === 'cancelled')
  const paused = ordering?.reason === 'paused'

  const pauseControls = (
    <div className="orders-pause">
      {paused ? (
        <button type="button" className="btn outline square" onClick={() => void pause(0)}>
          Ta emot beställningar igen
        </button>
      ) : (
        <>
          <label htmlFor="orders-pause">Pausa beställningar</label>
          <select
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
          </select>
        </>
      )}
    </div>
  )

  function card(order: Order) {
    const isBusy = busy === order.orderId
    const confirming = confirmCancel === order.orderId
    return (
      <article
        key={order.orderId}
        className={`order-card${fresh.has(order.orderId) ? ' fresh' : ''}`}
        aria-label={`Beställning ${order.number ?? ''}`}
      >
        <header className="order-card-head">
          <span className="order-number">#{order.number ?? '–'}</span>
          <span className={`status-badge ${order.mode === 'table' ? 'arrived' : 'waiting'}`}>
            {where(order)}
          </span>
          <span className="order-time" title="Betald">
            {clock(order.confirmedAt)}
          </span>
        </header>
        <ul className="order-lines">
          {order.lines.map((line) => (
            <li key={line.menuItemId}>
              <strong>{line.quantity} ×</strong> {line.name}
            </li>
          ))}
        </ul>
        {order.notes && <p className="order-notes">”{order.notes}”</p>}
        <p className="order-meta cell-muted">
          {order.customerName}
          {order.customerPhone ? ` · ${order.customerPhone}` : ''} · {kronor(order.totalAmount)}
          {order.mode === 'pickup' && order.status !== 'ready' && order.readyEstimate
            ? ` · lovad ca ${clock(order.readyEstimate)}`
            : ''}
        </p>
        <div className="order-actions">
          {order.status === 'confirmed' && (
            <button type="button" className="btn primary square" disabled={isBusy}
              onClick={() => void move(order, 'preparing')}>
              Påbörja – skicka sms
            </button>
          )}
          {order.status === 'preparing' && (
            <button type="button" className="btn primary square" disabled={isBusy}
              onClick={() => void move(order, 'ready')}>
              {order.mode === 'pickup' ? 'Klar – skicka sms' : 'Klar att servera'}
            </button>
          )}
          {order.status === 'ready' && (
            <button type="button" className="btn primary square" disabled={isBusy}
              onClick={() => void move(order, 'completed')}>
              {order.mode === 'pickup' ? 'Hämtad' : 'Serverad'}
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
          <p className="cell-muted">{resolving ? 'Hämtar platsen…' : 'Ingen plats är vald.'}</p>
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
                {ordering.prepMinutes ? ` · gästerna ser ca ${ordering.prepMinutes} min` : ''}
              </p>
            )}
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            {loadError && (
              <p className="form-error" role="alert">
                Kunde inte hämta beställningarna. Försöker igen…
              </p>
            )}
            {orders === null && !loadError ? (
              <p className="cell-muted">Hämtar beställningar…</p>
            ) : (
              <div className="orders-board">
                {COLUMNS.map((column) => {
                  const items = active.filter((o) => o.status === column.status)
                  return (
                    <section key={column.status} className="orders-column" aria-label={column.title}>
                      <h2 className="orders-column-title">
                        {column.title} <span className="cell-muted">{items.length}</span>
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
                      #{o.number} · {where(o)} · {o.customerName} · {kronor(o.totalAmount)} ·{' '}
                      {o.status === 'cancelled' ? 'Avbruten, återbetald' : `Klar ${clock(o.completedAt)}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </>
  )
}
