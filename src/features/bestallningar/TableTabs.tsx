import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import ModalOverlay from '../../shared/ModalOverlay'
import { ErrorNote } from '../../shared/ErrorNote'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Loading } from '../../shared/Loading'
import { Num } from '../../shared/motion/Num'
import { Select } from '../../shared/Select'
import { errorCode } from '../../shared/errors'
import { qrRuns } from '../table-qr/qrCard'
import {
  clock,
  kronor,
  listTabs,
  markPaidOutside,
  mismatchChecked,
  OUTSIDE_METHOD_TEXT,
  payLink,
  TAB_REFRESH,
  tabErrorText,
  tabKey,
  writeOff,
} from './ordersApi'
import type { OutsideMethod, PayLink, TableTab } from './ordersApi'
import './tableTabs.css'

/**
 * Notorna vid borden: alla obetalda QR-beställningar vid ett bord samma
 * serveringsdag. Personalen tar betalt innan gästerna går: "Betala med
 * mobilen" (gästen skannar en QR-kod och betalar hela notan med Stripe),
 * "Markera som betald" (betalt utanför Booqy, med hur) eller, för ägaren,
 * "Skriv av". Används på Beställningar (Notor) och på Layoutens bordskarta.
 */

/** Hur ofta QR-dialogen kollar om notan är betald. */
export const PAY_POLL_MS = 5_000

const MONTHS = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec']

/** "16 nov" från "2026-11-16". */
export function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return m && d ? `${d} ${MONTHS[m - 1]}` : date
}

/** Notans gula märke: från en tidigare dag, eller efter stängning. */
export function staleLabel(tab: Pick<TableTab, 'stale' | 'serviceDate'>, today: string | null): string | null {
  if (!tab.stale) return null
  return today && tab.serviceDate < today ? `Från ${dayLabel(tab.serviceDate)}` : 'Efter stängning'
}

/** Notorna som syns: öppna, under betalning, eller (ägaren) flaggade. */
export function visibleTabs(tabs: TableTab[] | null | undefined, isOwner: boolean): TableTab[] {
  return (tabs ?? []).filter((t) => t.count > 0 || t.paying || (isOwner && t.mismatch))
}

type Dialog = { kind: 'pay' | 'paid' | 'writeoff'; key: string }

export function TableTabsBoard({
  locationId,
  tabs,
  today,
  canAct,
  isOwner,
  timezone,
  focusKey,
  onChanged,
  empty = 'Inga öppna notor.',
}: {
  locationId: string
  tabs: TableTab[]
  /** Dagens serveringsdag (för "Från 16 nov"). */
  today: string | null
  /** Har området Beställningar: annars bara läsa (Layout). */
  canAct: boolean
  isOwner: boolean
  timezone?: string | null
  /** Notan att visa och markera (chip på tavlan, bordet på kartan). */
  focusKey?: string | null
  /** Hämta notorna (och beställningarna) igen. */
  onChanged: () => void
  empty?: string
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    if (!focusKey) return
    setFlash(focusKey)
    requestAnimationFrame(() =>
      document.getElementById(`tab-${focusKey}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }),
    )
    const timer = window.setTimeout(() => setFlash(null), 2600)
    return () => window.clearTimeout(timer)
  }, [focusKey])

  const find = (key: string) => tabs.find((t) => tabKey(t) === key) ?? null
  const open = dialog ? find(dialog.key) : null

  async function checked(tab: TableTab) {
    setBusyKey(tabKey(tab))
    setError(null)
    try {
      await mismatchChecked(locationId, tab)
      onChanged()
    } catch (err) {
      setError(tabErrorText(err, 'Notan ändrades inte.'))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="tabs-board">
      {notice && (
        <p className="save-notice" role="status">
          {notice}
        </p>
      )}
      <ErrorNote text={error} />
      {tabs.length === 0 ? (
        <p className="cell-muted">{empty}</p>
      ) : (
        <div className="tabs-grid">
          {tabs.map((tab) => (
            <TableTabCard
              key={tabKey(tab)}
              tab={tab}
              today={today}
              timezone={timezone}
              canAct={canAct}
              isOwner={isOwner}
              busy={busyKey === tabKey(tab)}
              flash={flash === tabKey(tab)}
              onPay={() => setDialog({ kind: 'pay', key: tabKey(tab) })}
              onPaid={() => setDialog({ kind: 'paid', key: tabKey(tab) })}
              onWriteOff={() => setDialog({ kind: 'writeoff', key: tabKey(tab) })}
              onChecked={() => void checked(tab)}
            />
          ))}
        </div>
      )}
      {dialog?.kind === 'pay' && (
        <PayDialog
          locationId={locationId}
          tab={open}
          tabKeyValue={dialog.key}
          onChanged={onChanged}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'paid' && open && (
        <PaidOutsideDialog
          tab={open}
          onSave={async (shown, input) => {
            await markPaidOutside(locationId, shown, { ...input, expectedAmount: shown.amount })
            setNotice(`${shown.title}: ${kronor(shown.amount)} betald utanför Booqy (${OUTSIDE_METHOD_TEXT[input.method].toLowerCase()}).`)
            onChanged()
          }}
          onRefresh={onChanged}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'writeoff' && open && (
        <WriteOffDialog
          tab={open}
          onSave={async (shown, reason) => {
            await writeOff(locationId, shown, { reason, expectedAmount: shown.amount })
            setNotice(`${shown.title}: ${kronor(shown.amount)} avskriven.`)
            onChanged()
          }}
          onRefresh={onChanged}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

/** En nota: bordet, vad som ska betalas, beställningarna och knapparna. */
export function TableTabCard({
  tab,
  today,
  timezone,
  canAct,
  isOwner,
  busy = false,
  flash = false,
  onPay,
  onPaid,
  onWriteOff,
  onChecked,
}: {
  tab: TableTab
  today: string | null
  timezone?: string | null
  canAct: boolean
  isOwner: boolean
  busy?: boolean
  flash?: boolean
  onPay: () => void
  onPaid: () => void
  onWriteOff: () => void
  onChecked: () => void
}) {
  const stale = staleLabel(tab, today)
  const key = tabKey(tab)
  const classes = ['tab-card', stale ? 'is-stale' : '', tab.paying ? 'is-paying' : '', flash ? 'is-focus' : '']
  return (
    <article id={`tab-${key}`} className={classes.filter(Boolean).join(' ')} aria-label={`Nota ${tab.title}`}>
      <header className="tab-card-head">
        <h3 className="tab-card-title">{tab.title}</h3>
        {stale && <span className="tab-badge tab-badge--stale">{stale}</span>}
        {tab.paying && <span className="tab-badge tab-badge--paying">Betalas nu</span>}
      </header>
      <p className="tab-card-amount">
        <span className="tab-card-amount-label">Att betala</span>
        <Num className="tab-card-amount-value">{kronor(tab.amount)}</Num>
      </p>
      {tab.orders.length > 0 && (
        <ul className="tab-card-orders" aria-label="Beställningar på notan">
          {tab.orders.map((o) => (
            <li key={o.orderId}>
              <details>
                <summary>
                  <span>#{o.number ?? '-'}</span>
                  <span className="cell-muted">{clock(o.createdAt ?? o.confirmedAt, timezone)}</span>
                  <span className="tab-card-order-sum">{kronor(o.totalAmount)}</span>
                </summary>
                <ul className="tab-card-lines">
                  {o.lines.map((line, i) => (
                    <li key={`${line.menuItemId}-${i}`}>
                      <span>
                        {line.quantity} × {line.name}
                      </span>
                      <span className="cell-muted">{kronor(line.total)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
      {isOwner && tab.mismatch && (
        <div className="tab-mismatch" role="note">
          <span className="tab-badge tab-badge--stale">Kontrollera notan</span>
          <InfoTooltip label="Kontrollera notan">
            Gästens betalning täckte en beställning som redan var stängd. Betala tillbaka mellanskillnaden i Stripe och
            tryck sedan Kontrollerad.
          </InfoTooltip>
          {canAct && (
            <button type="button" className="btn outline square" disabled={busy} onClick={onChecked}>
              Kontrollerad
            </button>
          )}
        </div>
      )}
      {canAct && tab.count > 0 && (
        <div className="tab-card-actions">
          <button type="button" className="btn primary square" disabled={busy} onClick={onPay}>
            Betala med mobilen
          </button>
          <button type="button" className="btn outline square" disabled={busy} onClick={onPaid}>
            Markera som betald
          </button>
          {isOwner && (
            <button type="button" className="btn danger-outline square" disabled={busy} onClick={onWriteOff}>
              Skriv av
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/* ---------- Dialogerna ---------- */

/** Dialogens skal: bakgrund, fokusfälla, Escape stänger (inte medan den sparar). */
function TabDialog({
  title,
  className,
  busy,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  className?: string
  busy: boolean
  onClose: () => void
  onSubmit?: (e: FormEvent) => void
  children: ReactNode
}) {
  const id = useId()
  const ref = useRef<HTMLFormElement>(null)
  const busyRef = useRef(busy)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not(:disabled)')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      if (!busyRef.current) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus()
    }
  }, [onClose])

  function trapTab(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>('input, textarea, button:not(:disabled), [role="combobox"]')]
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  return (
    <ModalOverlay
      className="tab-dialog-overlay"
      onPointerDown={(e) => e.target === e.currentTarget && !busyRef.current && onClose()}
    >
      <form
        ref={ref}
        className={`modal tab-dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={trapTab}
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit?.(e)
        }}
        noValidate
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </form>
    </ModalOverlay>
  )
}

function Amount({ tab }: { tab: TableTab }) {
  return (
    <p className="tab-dialog-amount">
      <span>
        Att betala{' '}
        <span className="cell-muted">
          ({tab.count} {tab.count === 1 ? 'beställning' : 'beställningar'})
        </span>
      </span>
      <strong>{kronor(tab.amount)}</strong>
    </p>
  )
}

/** QR-koden som SVG (samma moduler som de utskrivna bordskorten). */
export function QrImage({ url, label }: { url: string; label: string }) {
  const { size, runs } = qrRuns(url)
  const quiet = 4
  return (
    <svg
      className="tab-qr"
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={size + quiet * 2} height={size + quiet * 2} fill="#fff" />
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="#000" />
      ))}
    </svg>
  )
}

/**
 * "Betala med mobilen": en QR-kod (och länk) till notan. Kollar var femte
 * sekund; när beställningarna på länken är betalda syns stämpeln Betald.
 * Beställningar som kommer under tiden hamnar på en ny nota.
 */
function PayDialog({
  locationId,
  tab,
  tabKeyValue,
  onChanged,
  onClose,
}: {
  locationId: string
  tab: TableTab | null
  tabKeyValue: string
  onChanged: () => void
  onClose: () => void
}) {
  // Notan när länken skapades: beloppet och beställningarna länken gäller.
  const [start] = useState(tab)
  const [link, setLink] = useState<PayLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paid, setPaid] = useState(false)
  const [paying, setPaying] = useState(Boolean(tab?.paying))
  const [copied, setCopied] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Sidans callback kan vara ny vid varje render; länken ska bara hämtas en gång.
  const changed = useRef(onChanged)
  useEffect(() => {
    changed.current = onChanged
  }, [onChanged])

  useEffect(() => {
    if (!start) return
    let live = true
    setError(null)
    payLink(locationId, start).then(
      (l) => live && setLink(l),
      (err) => {
        if (!live) return
        setError(tabErrorText(err, 'QR-koden kunde inte visas.'))
        if (TAB_REFRESH.has(errorCode(err) ?? '')) changed.current()
      },
    )
    return () => {
      live = false
    }
  }, [locationId, start, attempt])

  useEffect(() => {
    if (!link || paid || !start) return
    const ids = new Set(start.orders.map((o) => o.orderId))
    const timer = window.setInterval(() => {
      listTabs(locationId).then(
        (list) => {
          const now = list.tabs.find((t) => tabKey(t) === tabKeyValue)
          setPaying(Boolean(now?.paying))
          const left = (now?.orders ?? []).filter((o) => ids.has(o.orderId))
          if (!now || (now.orders.length > 0 && left.length === 0) || now.count === 0) {
            setPaid(true)
            changed.current()
          }
        },
        () => undefined,
      )
    }, PAY_POLL_MS)
    return () => window.clearInterval(timer)
  }, [link, paid, start, locationId, tabKeyValue])

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const title = start ? `Betala med mobilen, ${start.title}` : 'Betala med mobilen'
  return (
    <TabDialog title={title} className="tab-dialog--pay" busy={false} onClose={onClose}>
      {!start ? (
        <p>Notan är redan stängd.</p>
      ) : paid ? (
        <div className="tab-paid" role="status">
          <span className="tab-paid-stamp">Betald</span>
          <p>Notan är betald.</p>
        </div>
      ) : error ? (
        <ErrorNote text={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : !link ? (
        <Loading label="Hämtar QR-koden" />
      ) : (
        <>
          <div className="tab-qr-wrap">
            <QrImage url={link.url} label={`QR-kod för notan, ${start.title}`} />
          </div>
          <p className="tab-dialog-amount">
            <span>
              Att betala{' '}
              <InfoTooltip label="Betala med mobilen">
                Gästen skannar och betalar hela notan med kort, Swish eller Klarna. Beställningar som kommer under
                tiden hamnar på en ny nota.
              </InfoTooltip>
            </span>
            <strong>{kronor(link.amount)}</strong>
          </p>
          {paying && (
            <p className="tab-dialog-status" role="status">
              <Loading variant="inline" label="Gästen betalar" />
            </p>
          )}
        </>
      )}
      <div className="modal-actions">
        {link && !paid && (
          <button type="button" className="btn outline square" onClick={() => void copy()}>
            {copied ? 'Kopierad' : 'Kopiera länk'}
          </button>
        )}
        <button type="button" className="btn primary square" onClick={onClose}>
          {paid ? 'OK' : 'Stäng'}
        </button>
      </div>
    </TabDialog>
  )
}

const METHODS = Object.keys(OUTSIDE_METHOD_TEXT) as OutsideMethod[]

/**
 * Notan som dialogen visar: den låses när dialogen öppnas, så att en ny
 * beställning som kommer med listans uppdatering inte tyst ändrar beloppet
 * personalen redan har tagit betalt för. Servern svarar bill_changed om
 * notan har ändrats; då visas den nya notan (`resync`) och personalen sparar igen.
 */
function useShownTab(tab: TableTab): [TableTab, () => void] {
  const [shown, setShown] = useState(tab)
  const [resync, setResync] = useState(false)
  // Under render (Reacts mönster för att följa en ny prop), inte i en effekt.
  if (resync && tab !== shown) {
    setShown(tab)
    setResync(false)
  }
  return [shown, () => setResync(true)]
}

/** "Markera som betald": hur gästen betalade, valfri anteckning. */
function PaidOutsideDialog({
  tab,
  onSave,
  onRefresh,
  onClose,
}: {
  tab: TableTab
  onSave: (shown: TableTab, input: { method: OutsideMethod; note?: string }) => Promise<void>
  onRefresh: () => void
  onClose: () => void
}) {
  const id = useId()
  const [shown, resync] = useShownTab(tab)
  const [method, setMethod] = useState<OutsideMethod | ''>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  async function submit() {
    if (busy) return
    setTried(true)
    if (!method) {
      setError('Välj hur gästen betalade.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(shown, { method, ...(note.trim() ? { note: note.trim() } : {}) })
      onClose()
    } catch (err) {
      setError(tabErrorText(err, 'Notan markerades inte som betald.'))
      if (TAB_REFRESH.has(errorCode(err) ?? '')) {
        resync()
        onRefresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <TabDialog title={`Markera som betald, ${shown.title}`} busy={busy} onClose={onClose} onSubmit={() => void submit()}>
      <Amount tab={shown} />
      <div className="form-field">
        <span className="tab-dialog-label">
          <label htmlFor={`${id}-method`}>Hur betalade gästen?</label>
          <InfoTooltip label="Betald utanför Booqy">
            Booqy ger inget kvitto för det här. Kvittot kommer från ert eget system.
          </InfoTooltip>
        </span>
        <Select
          id={`${id}-method`}
          value={method}
          disabled={busy}
          aria-invalid={tried && !method ? true : undefined}
          onChange={(e) => {
            setMethod(e.target.value as OutsideMethod | '')
            setError(null)
          }}
        >
          <option value="">Välj…</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {OUTSIDE_METHOD_TEXT[m]}
            </option>
          ))}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-note`}>Anteckning (valfri)</label>
        <input id={`${id}-note`} maxLength={200} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ErrorNote text={error} />
      <div className="modal-actions">
        <button type="button" className="btn outline square" disabled={busy} onClick={onClose}>
          Avbryt
        </button>
        <button type="submit" className="btn primary square" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Sparar…' : 'Spara'}
        </button>
      </div>
    </TabDialog>
  )
}

/** Ägaren: "Skriv av" med anledning (krävs). */
function WriteOffDialog({
  tab,
  onSave,
  onRefresh,
  onClose,
}: {
  tab: TableTab
  onSave: (shown: TableTab, reason: string) => Promise<void>
  onRefresh: () => void
  onClose: () => void
}) {
  const id = useId()
  const [shown, resync] = useShownTab(tab)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  async function submit() {
    if (busy) return
    if (!reason.trim()) {
      setError('Skriv varför notan skrivs av.')
      reasonRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(shown, reason.trim())
      onClose()
    } catch (err) {
      setError(tabErrorText(err, 'Notan skrevs inte av.'))
      if (TAB_REFRESH.has(errorCode(err) ?? '')) {
        resync()
        onRefresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <TabDialog title={`Skriv av, ${shown.title}`} busy={busy} onClose={onClose} onSubmit={() => void submit()}>
      <Amount tab={shown} />
      <div className="form-field">
        <span className="tab-dialog-label">
          <label htmlFor={`${id}-reason`}>Varför?</label>
          <InfoTooltip label="Skriv av">Notan stängs utan betalning. Den räknas inte som försäljning.</InfoTooltip>
        </span>
        <textarea
          ref={reasonRef}
          id={`${id}-reason`}
          rows={2}
          maxLength={200}
          value={reason}
          disabled={busy}
          aria-invalid={error && !reason.trim() ? true : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ErrorNote text={error} />
      <div className="modal-actions">
        <button type="button" className="btn outline square" disabled={busy} onClick={onClose}>
          Avbryt
        </button>
        <button type="submit" className="btn primary square" data-danger="true" disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Skriver av…' : `Skriv av ${kronor(shown.amount)}`}
        </button>
      </div>
    </TabDialog>
  )
}
