import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { clock, kronor } from '../../features/bestallningar/ordersApi'
import type { Order } from '../../features/bestallningar/ordersApi'
import { canOpen } from '../access'
import { Icon } from '../Icon'
import ModalOverlay from '../ModalOverlay'
import { reducedMotion } from '../motion/countUp'
import { Num } from '../motion/Num'
import { hasFeature, useTenant } from '../tenant'
import { requestLeave } from '../unsaved'
import { unlockOrderAudio } from './alertSound'
import { orderSummary } from './queue'
import { acknowledgeOrders, requestOrderFocus, setAlertEscape, setAlertScope, useOrderAlerts } from './store'
import { useOrderWatch } from './watch'
import './orderAlert.css'

/** Ett tryck eller en tangent så här snart efter att rutan öppnats eller fått en ny rad räknas inte. */
const OK_GUARD_MS = 600

/**
 * Larmet för nya onlinebeställningar, i skalet (AdminLayout) så att det
 * syns på varje sida. Ett högt ljud och rutan "Ny beställning"; fler som
 * kommer innan någon trycker OK läggs överst i samma ruta, med ljud igen.
 * OK (eller Escape) stänger och tömmer; nästa nya öppnar en ny ruta. En rad
 * öppnar Beställningar med den beställningen markerad (och stänger rutan:
 * alla nya står där under Nya).
 */
export function OrderAlert({ guardMs = OK_GUARD_MS }: { guardMs?: number } = {}) {
  const { tenant, locationId, status } = useTenant()
  const enabled =
    status === 'ready' && Boolean(locationId) && hasFeature(tenant, 'ordering') && canOpen(tenant, 'bestallningar')
  useEffect(() => {
    // Medan restaurangen hämtas vet vi inget än: rör inte det fliken hade (en
    // omladdning ska få tillbaka en öppen ruta). Sedan: platsen, eller inget larm.
    if (status === 'idle' || status === 'loading') return
    setAlertScope(enabled ? locationId : null)
  }, [status, enabled, locationId])
  useOrderWatch(locationId, enabled)
  const { open, muted, rev, latest } = useOrderAlerts()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (!enabled || open.length === 0) return null
  return (
    <OrderAlertDialog
      orders={open}
      muted={muted}
      rev={rev}
      latest={latest}
      guardMs={guardMs}
      onOk={acknowledgeOrders}
      onOpen={(orderId) => {
        // Rutan stängs först: frågar sidan om osparat (LeaveGuard) syns frågan, inte gömd under rutan.
        acknowledgeOrders()
        const go = () => {
          requestOrderFocus(orderId)
          if (window.location.pathname !== '/bestallningar') navigate('/bestallningar')
        }
        if (pathname === '/bestallningar') go()
        else requestLeave(go)
      }}
    />
  )
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/** "#12, Åsa Öberg, 18:40, 460 kr, allergi": samma ord som raden läses upp med. */
function slipLabel(order: Order): string {
  const allergy = order.lines.some((l) => l.allergy)
  return [`#${order.number ?? ''}`, order.customerName, clock(order.confirmedAt ?? order.createdAt), kronor(order.totalAmount), allergy ? 'allergi' : '']
    .filter(Boolean)
    .join(', ')
}

export function OrderAlertDialog({
  orders,
  muted,
  rev,
  latest,
  onOk,
  onOpen,
  guardMs = OK_GUARD_MS,
}: {
  orders: readonly Order[]
  muted: boolean
  rev: number
  latest: readonly string[]
  onOk: () => void
  onOpen: (orderId: string) => void
  guardMs?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [firstRev] = useState(rev)
  // Där fokus var innan rutan kom, läst medan den ritas: ovanpå en <dialog>
  // flyttar showModal fokus in i rutan innan effekterna körs.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  /** När rutan öppnades eller fick en ny rad (vakten mot ett tryck som var på väg någon annanstans). */
  const armedAt = useRef(0)
  const onOkRef = useRef(onOk)
  useEffect(() => {
    onOkRef.current = onOk
  })
  // En tangent (Enter, mellanslag, Escape) får längre vakt: den som skrev i ett fält skriver vidare en stund.
  const keyGuardMs = guardMs * 2.5
  const guarded = (e: { detail: number }) => performance.now() - armedAt.current < (e.detail === 0 ? keyGuardMs : guardMs)

  useEffect(() => {
    armedAt.current = performance.now()
    okRef.current?.focus({ preventScroll: true })
    const box = boxRef.current
    // Sidan bakom går inte att nå medan rutan är öppen (rutan ligger i <body>, sidan i #root).
    const root = document.getElementById('root')
    const wasInert = root?.inert ?? false
    if (root && box && !root.contains(box)) root.inert = true
    // Tar något bakom fokus (en dialog som fokuserar sig själv igen) går det tillbaka till OK.
    const onFocusIn = (e: FocusEvent) => {
      if (box && e.target instanceof Node && !box.contains(e.target)) okRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('focusin', onFocusIn)
    const onEscape = () => {
      if (performance.now() - armedAt.current < keyGuardMs) return
      onOkRef.current()
    }
    const shared = setAlertEscape(onEscape)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      onEscape()
    }
    if (!shared) window.addEventListener('keydown', onKey, true)
    return () => {
      setAlertEscape(null)
      if (!shared) window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocusIn)
      if (root) root.inert = wasInert
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [keyGuardMs, opener])

  // En ny rad: överst i listan, som syns (listan rullar upp till den).
  useLayoutEffect(() => {
    if (rev === firstRev) return
    armedAt.current = performance.now()
    const list = listRef.current
    if (list && list.scrollTop > 0) {
      if (typeof list.scrollTo === 'function') list.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' })
      else list.scrollTop = 0
    }
  }, [rev, firstRev])

  // Ljudknappen försvinner när ljudet går: fokus stannar i rutan, på OK.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!muted && box && !box.contains(document.activeElement)) okRef.current?.focus({ preventScroll: true })
  }, [muted])

  const count = orders.length
  const appended = rev !== firstRev
  const fresh = new Set(appended ? latest : [])
  const announce = appended
    ? orders
        .filter((o) => fresh.has(o.orderId))
        .map((o) => `Ny beställning ${slipLabel(o)}`)
        .join('. ')
    : ''

  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !boxRef.current) return
    const items = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const ok = (e: ReactMouseEvent) => {
    if (guarded(e)) {
      e.preventDefault()
      return
    }
    onOk()
  }

  return (
    <ModalOverlay className="order-alert-overlay">
      <div
        ref={boxRef}
        className="modal order-alert"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="order-alert-title"
        aria-describedby="order-alert-desc"
        onKeyDown={trapTab}
      >
        <header className="order-alert-head">
          <span key={rev} className="order-alert-badge" aria-hidden="true">
            <Icon name="bag" size={22} />
          </span>
          <h2 id="order-alert-title" className="order-alert-title">
            {count === 1 ? 'Ny beställning' : 'Nya beställningar'}{' '}
            {count > 1 && (
              <span className="order-alert-count">
                <Num>{count}</Num>
              </span>
            )}
          </h2>
        </header>
        <p id="order-alert-desc" className="sr-only">
          {count === 1 ? slipLabel(orders[0]) : `Senaste ${slipLabel(orders[0])}`}
        </p>
        {muted && (
          <button
            type="button"
            className="order-alert-sound"
            onClick={() => {
              // Trycket väcker ljudet; larmet som inte hördes spelas då (store.ts).
              unlockOrderAudio()
              okRef.current?.focus({ preventScroll: true })
            }}
          >
            <Icon name="sound" size={20} />
            Tryck för att slå på ljudet
          </button>
        )}
        <ol ref={listRef} className="order-alert-list" aria-label="Beställningar, nyaste först">
          {orders.map((o) => (
            <li key={o.orderId} className={fresh.has(o.orderId) ? 'order-alert-item is-new' : 'order-alert-item'}>
              <div className="order-alert-cell">
                <OrderSlip order={o} onOpen={onOpen} guarded={guarded} />
              </div>
            </li>
          ))}
        </ol>
        <p className="sr-only" aria-live="assertive">
          {announce}
        </p>
        <div className="modal-actions order-alert-actions">
          <button ref={okRef} type="button" className="btn primary square order-alert-ok" onClick={ok}>
            OK
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/** En rad i rutan: en lapp med nummer, tid, total, gästen och vad som beställts. */
function OrderSlip({
  order,
  onOpen,
  guarded,
}: {
  order: Order
  onOpen: (orderId: string) => void
  guarded: (e: { detail: number }) => boolean
}) {
  const time = clock(order.confirmedAt ?? order.createdAt)
  const allergy = order.lines.some((l) => l.allergy)
  const total = kronor(order.totalAmount)
  return (
    <button
      type="button"
      className="order-alert-slip"
      aria-label={`Öppna ${slipLabel(order)}`}
      onClick={(e) => {
        if (guarded(e)) {
          e.preventDefault()
          return
        }
        onOpen(order.orderId)
      }}
    >
      <span className="order-alert-top">
        <span className="order-alert-number">#{order.number ?? '-'}</span>
        {time && <span className="order-alert-time">{time}</span>}
        <span className="order-alert-total">
          <Num>{total}</Num>
        </span>
      </span>
      <span className="order-alert-who">
        {order.customerName && <span className="order-alert-name">{order.customerName}</span>}
        {allergy && <span className="order-alert-allergy">Allergi</span>}
      </span>
      <span className="order-alert-what">{orderSummary(order)}</span>
      <Icon name="chevron-right" size={20} className="order-alert-go" />
    </button>
  )
}
