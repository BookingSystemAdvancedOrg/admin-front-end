import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { ApiError } from '../../shared/api'
import { Icon } from '../../shared/Icon'
import { Loading } from '../../shared/Loading'
import { useLocationId } from '../../shared/location'
import { useTenant } from '../../shared/tenant'
import { useAuth } from '../auth/useAuth'
import { clock, kronor } from '../bestallningar/ordersApi'
import {
  MAX_ORE,
  MIN_ORE,
  act,
  createPayment,
  errorText,
  failureText,
  getPayment,
  getReceipt,
  listPayableOrders,
  listPayments,
  listReaders,
  newCheckoutId,
  parseKronor,
  rememberReader,
  rememberedReader,
  sendReceipt,
  simulate,
} from './cardApi'
import type { CardPayment, CardReader, PayableOrder, Receipt } from './cardApi'
import './tabetalt.css'

/** Hur ofta en pågående betalning frågas om. */
export const POLL_MS = 2_000
/** Efter så här länge utan svar föreslås Avbryt. */
const SLOW_MS = 90_000

const STATUS_TEXT: Record<CardPayment['status'], string> = {
  processing: 'Väntar på kort',
  succeeded: 'Betald',
  failed: 'Nekad',
  canceled: 'Avbruten',
  refunded: 'Återbetald',
}

const STATUS_BADGE: Record<CardPayment['status'], string> = {
  processing: 'waiting',
  succeeded: 'arrived',
  failed: 'cancelled',
  canceled: 'reserved',
  refunded: 'reserved',
}

function orderLabel(order: PayableOrder): string {
  const where = order.mode === 'table' ? `Bord ${order.tableLabel ?? '?'}` : 'Avhämtning'
  return `${where}${order.customerName ? `, ${order.customerName}` : ''} (${kronor(order.totalAmount)})`
}

function cardLine(p: CardPayment): string {
  if (!p.card?.last4) return ''
  const brand = (p.card.brand ?? 'Kort').replace(/^\w/, (c) => c.toUpperCase())
  return `${brand} **** ${p.card.last4}`
}

/**
 * Ta betalt: kortbetalning på restaurangens kortläsare (Stripe Terminal).
 * Byggd för personal mitt i rusningen: belopp, läsare, en stor knapp, och
 * sedan ett stort tydligt läge (Väntar på kort, Betald, Nekad) med
 * Avbryt / Försök igen. Dagens kortköp listas bredvid med kvitto och, för
 * ägaren, återbetalning.
 */
export default function TaBetaltPage() {
  const { sub } = useAuth()
  const { tenant } = useTenant()
  const isOwner = tenant?.role === 'owner_user'
  const { locationId, resolving } = useLocationId(sub)

  const [readers, setReaders] = useState<CardReader[] | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [readerId, setReaderId] = useState('')
  const [mode, setMode] = useState<'amount' | 'order'>('amount')
  const [amountText, setAmountText] = useState('')
  const [note, setNote] = useState('')
  const [orders, setOrders] = useState<PayableOrder[]>([])
  const [orderId, setOrderId] = useState('')
  const [current, setCurrent] = useState<CardPayment | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [today, setToday] = useState<CardPayment[] | null>(null)
  const [receipt, setReceipt] = useState<{ payment: CardPayment; receipt: Receipt } | null>(null)
  const [confirmRefund, setConfirmRefund] = useState<string | null>(null)
  const checkoutId = useRef<string>(newCheckoutId())
  const amountRef = useRef<HTMLInputElement>(null)

  const loadToday = useCallback(async () => {
    if (!locationId) return
    try {
      const list = await listPayments(locationId)
      setToday(list.payments)
    } catch {
      setToday((prev) => prev ?? [])
    }
  }, [locationId])

  const loadReaders = useCallback(async () => {
    if (!locationId) return
    try {
      const result = await listReaders(locationId)
      setEnabled(result.enabled)
      setReaders(result.readers)
      setLoadError(null)
      setReaderId((chosen) => {
        if (chosen && result.readers.some((r) => r.id === chosen)) return chosen
        const remembered = rememberedReader(locationId)
        const pick = result.readers.find((r) => r.id === remembered)
          ?? result.readers.find((r) => r.status === 'online')
          ?? result.readers[0]
        return pick?.id ?? ''
      })
    } catch (err) {
      setLoadError(errorText(err))
      setReaders([])
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    void loadReaders()
    void loadToday()
    listPayableOrders(locationId).then(setOrders).catch(() => setOrders([]))
  }, [locationId, loadReaders, loadToday])

  // En pågående betalning frågas om tills läsaren svarat.
  const pollId = current?.status === 'processing' ? `${current.paymentId}:${current.attempt ?? 1}` : null
  useEffect(() => {
    if (!locationId || !pollId) return
    const paymentId = pollId.split(':')[0]
    const started = Date.now()
    const timer = window.setInterval(async () => {
      if (Date.now() - started > SLOW_MS) setSlow(true)
      try {
        const next = await getPayment(locationId, paymentId)
        if (next.status !== 'processing') {
          setCurrent(next)
          void loadToday()
        }
      } catch {
        // Nätet hackar: nästa fråga om två sekunder.
      }
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [locationId, pollId, loadToday])

  const amount = mode === 'order'
    ? orders.find((o) => o.orderId === orderId)?.totalAmount ?? null
    : parseKronor(amountText)
  const amountError = mode === 'amount' && amountText.trim() !== '' && (amount === null || amount < MIN_ORE || amount > MAX_ORE)
    ? `Ange ett belopp mellan ${kronor(MIN_ORE)} och ${kronor(MAX_ORE)}, högst två decimaler.`
    : null
  const reader = readers?.find((r) => r.id === readerId)
  const canSend = Boolean(locationId && reader && amount !== null && !amountError && !sending)

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!locationId || !reader || amount === null || amountError) return
    setSending(true)
    setError(null)
    rememberReader(locationId, reader.id)
    try {
      const payment = await createPayment(locationId, {
        checkoutId: checkoutId.current,
        readerId: reader.id,
        ...(mode === 'order' ? { orderId } : { amount, note: note.trim() || undefined }),
      })
      setCurrent(payment)
      void loadToday()
    } catch (err) {
      setError(errorText(err))
      // Ett köp som säkert inte skapats får ett nytt id; annars hittar samma id samma betalning.
      if (err instanceof ApiError && err.status < 500) {
        checkoutId.current = newCheckoutId()
      }
    } finally {
      setSending(false)
    }
  }

  async function run(action: 'cancel' | 'retry', body?: object) {
    if (!locationId || !current) return
    setSending(true)
    setError(null)
    setSlow(false)
    try {
      setCurrent(await act(locationId, current.paymentId, action, body))
      void loadToday()
    } catch (err) {
      setError(errorText(err))
      getPayment(locationId, current.paymentId).then(setCurrent).catch(() => undefined)
    } finally {
      setSending(false)
    }
  }

  function startOver() {
    checkoutId.current = newCheckoutId()
    setCurrent(null)
    setError(null)
    setAmountText('')
    setNote('')
    setOrderId('')
    setSlow(false)
    if (locationId) listPayableOrders(locationId).then(setOrders).catch(() => undefined)
    window.setTimeout(() => amountRef.current?.focus(), 0)
  }

  async function openReceipt(p: CardPayment) {
    if (!locationId) return
    try {
      setReceipt(await getReceipt(locationId, p.paymentId))
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function refund(p: CardPayment) {
    if (!locationId) return
    setError(null)
    try {
      const updated = await act(locationId, p.paymentId, 'refund')
      setToday((prev) => (prev ?? []).map((x) => (x.paymentId === updated.paymentId ? updated : x)))
      if (current?.paymentId === updated.paymentId) setCurrent(updated)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setConfirmRefund(null)
    }
  }

  const noReaders = readers !== null && (!enabled || readers.length === 0)

  return (
    <>
      <AdminTopbar title="Ta betalt" />
      <div className="admin-main">
        {!locationId ? (
          resolving ? <Loading label="Hämtar platsen" /> : <p className="cell-muted">Ingen plats är vald.</p>
        ) : readers === null ? (
          <Loading label="Hämtar kortläsare" />
        ) : (
          <div className="pay-layout">
            <section className="admin-card pay-panel" aria-label="Kortbetalning">
              {loadError ? (
                <div className="pay-empty">
                  <p className="form-error" role="alert">{loadError}</p>
                  <button type="button" className="btn outline" onClick={() => void loadReaders()}>Försök igen</button>
                </div>
              ) : noReaders ? (
                <div className="pay-empty">
                  <Icon name="card" size={32} />
                  <h2>{enabled ? 'Ingen kortläsare kopplad' : 'Kortterminaler är inte aktiverade'}</h2>
                  <p className="cell-muted">
                    {isOwner
                      ? 'Booqy beställer och kopplar en Stripe Reader S700 till restaurangen. Kontakta Booqy support så är läsaren klar att använda här.'
                      : 'Be restaurangens ägare kontakta Booqy, så kopplas en kortläsare till platsen.'}
                  </p>
                </div>
              ) : current ? (
                <PaymentStage
                  payment={current}
                  readers={readers}
                  busy={sending}
                  slow={slow}
                  error={error}
                  onCancel={() => void run('cancel')}
                  onRetry={(id) => void run('retry', id ? { readerId: id } : undefined)}
                  onNew={startOver}
                  onReceipt={() => void openReceipt(current)}
                  onSimulate={(outcome) => void simulate(locationId, current.paymentId, outcome).catch((err) => setError(errorText(err)))}
                />
              ) : (
                <form className="pay-form" onSubmit={(e) => void send(e)}>
                  <div className="pay-mode" role="radiogroup" aria-label="Vad ska betalas">
                    <button type="button" role="radio" aria-checked={mode === 'amount'}
                      className={mode === 'amount' ? 'active' : ''} onClick={() => setMode('amount')}>
                      Belopp
                    </button>
                    <button type="button" role="radio" aria-checked={mode === 'order'}
                      className={mode === 'order' ? 'active' : ''} onClick={() => setMode('order')}>
                      Obetald beställning{orders.length ? ` (${orders.length})` : ''}
                    </button>
                  </div>

                  {mode === 'amount' ? (
                    <>
                      <div className="form-field">
                        <label htmlFor="pay-amount">Belopp</label>
                        <div className="pay-amount">
                          <input
                            id="pay-amount"
                            ref={amountRef}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder="0"
                            value={amountText}
                            aria-invalid={Boolean(amountError)}
                            aria-describedby={amountError ? 'pay-amount-error' : undefined}
                            onChange={(e) => setAmountText(e.target.value)}
                            autoFocus
                          />
                          <span aria-hidden="true">kr</span>
                        </div>
                        {amountError && <p id="pay-amount-error" className="pay-field-error">{amountError}</p>}
                      </div>
                      <div className="form-field">
                        <label htmlFor="pay-note">Notering (valfritt)</label>
                        <input id="pay-note" maxLength={120} placeholder="T.ex. bord 4" value={note}
                          onChange={(e) => setNote(e.target.value)} />
                      </div>
                    </>
                  ) : (
                    <div className="form-field">
                      <label htmlFor="pay-order">Beställning</label>
                      {orders.length ? (
                        <select id="pay-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                          <option value="">Välj beställning</option>
                          {orders.map((o) => (
                            <option key={o.orderId} value={o.orderId}>
                              {orderLabel(o)}{o.createdAt ? `, ${clock(o.createdAt)}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="cell-muted">Inga obetalda beställningar just nu. Beställningar som gästen inte betalat online visas här.</p>
                      )}
                    </div>
                  )}

                  <div className="form-field">
                    <label htmlFor="pay-reader">Kortläsare</label>
                    <select id="pay-reader" value={readerId} onChange={(e) => setReaderId(e.target.value)}>
                      {readers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}{r.status === 'offline' ? ' (offline)' : ''}
                        </option>
                      ))}
                    </select>
                    {reader?.status === 'offline' && (
                      <p className="pay-field-error">Läsaren är offline. Starta den eller välj en annan.</p>
                    )}
                  </div>

                  {error && <p className="form-error" role="alert">{error}</p>}

                  <button type="submit" className="btn primary pay-send" disabled={!canSend}>
                    <Icon name="card" size={20} />
                    {sending ? 'Skickar till läsaren' : amount !== null && !amountError ? `Ta betalt ${kronor(amount)}` : 'Ta betalt'}
                  </button>
                </form>
              )}
            </section>

            <aside className="pay-side">
              {receipt ? (
                <ReceiptSlip
                  data={receipt}
                  onClose={() => setReceipt(null)}
                  onSend={async (email) => {
                    await sendReceipt(locationId, receipt.payment.paymentId, email)
                  }}
                />
              ) : (
                <section className="admin-card pay-today" aria-label="Kortköp idag">
                  <h2>Kortköp idag</h2>
                  {today === null ? (
                    <p className="cell-muted">Hämtar…</p>
                  ) : today.length === 0 ? (
                    <p className="cell-muted">Inga kortköp ännu idag.</p>
                  ) : (
                    <ul>
                      {today.map((p) => (
                        <li key={p.paymentId}>
                          <div className="pay-row">
                            <span className="pay-row-amount">{kronor(p.amount)}</span>
                            <span className={`status-badge ${STATUS_BADGE[p.status]}`}>{STATUS_TEXT[p.status]}</span>
                          </div>
                          <p className="cell-muted pay-row-meta">
                            {clock(p.paidAt ?? p.createdAt)}
                            {p.orderNumber ? ` · Beställning #${p.orderNumber}` : p.note ? ` · ${p.note}` : ''}
                            {cardLine(p) ? ` · ${cardLine(p)}` : ''}
                          </p>
                          {(p.status === 'succeeded' || p.status === 'refunded') && (
                            <div className="pay-row-actions">
                              <button type="button" className="btn outline" onClick={() => void openReceipt(p)}>
                                <Icon name="receipt" size={16} /> Kvitto
                              </button>
                              {isOwner && p.status === 'succeeded' && !p.orderId && (
                                confirmRefund === p.paymentId ? (
                                  <>
                                    <button type="button" className="btn danger-outline" onClick={() => void refund(p)}>
                                      Bekräfta: återbetala {kronor(p.amount)}
                                    </button>
                                    <button type="button" className="btn outline" onClick={() => setConfirmRefund(null)}>
                                      Behåll
                                    </button>
                                  </>
                                ) : (
                                  <button type="button" className="btn outline" onClick={() => setConfirmRefund(p.paymentId)}>
                                    <Icon name="undo" size={16} /> Återbetala
                                  </button>
                                )
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </aside>
          </div>
        )}
      </div>
    </>
  )
}

function PaymentStage({
  payment,
  readers,
  busy,
  slow,
  error,
  onCancel,
  onRetry,
  onNew,
  onReceipt,
  onSimulate,
}: {
  payment: CardPayment
  readers: CardReader[]
  busy: boolean
  slow: boolean
  error: string | null
  onCancel: () => void
  onRetry: (readerId?: string) => void
  onNew: () => void
  onReceipt: () => void
  onSimulate: (outcome: 'approve' | 'decline') => void
}) {
  const [other, setOther] = useState('')
  const state = payment.status === 'processing' ? 'waiting'
    : payment.status === 'succeeded' ? 'paid'
      : payment.status === 'refunded' ? 'refunded' : 'declined'
  const title = {
    waiting: 'Väntar på kort…',
    paid: 'Betalt',
    refunded: 'Återbetald',
    declined: payment.status === 'canceled' ? 'Avbruten' : 'Nekat',
  }[state]
  const icon = state === 'paid' ? 'check' : state === 'declined' ? 'close' : 'card'
  const others = readers.filter((r) => r.id !== payment.readerId)

  return (
    <div className={`pay-stage ${state}`}>
      <div className="pay-stage-mark" aria-hidden="true">
        <Icon name={icon} size={44} />
      </div>
      <p className="pay-stage-amount">{kronor(payment.amount)}</p>
      <h2 className="pay-stage-title" role="status" aria-live="polite">{title}</h2>
      <p className="pay-stage-detail">
        {state === 'waiting' && `Gästen blippar, sätter i eller håller mobilen mot ${payment.readerLabel ?? 'läsaren'}.`}
        {state === 'paid' && (cardLine(payment) ? `${cardLine(payment)} · ${payment.readerLabel ?? ''}` : payment.readerLabel)}
        {state === 'declined' && failureText(payment)}
        {state === 'refunded' && 'Pengarna är på väg tillbaka till kortet.'}
      </p>
      {slow && state === 'waiting' && (
        <p className="pay-stage-hint">Inget svar från läsaren än. Kontrollera läsaren, eller tryck Avbryt och försök igen.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="pay-stage-actions">
        {state === 'waiting' && (
          <button type="button" className="btn danger-outline pay-big" disabled={busy} onClick={onCancel}>
            Avbryt
          </button>
        )}
        {state === 'declined' && (
          <>
            <button type="button" className="btn primary pay-big" disabled={busy} onClick={() => onRetry(other || undefined)}>
              Försök igen
            </button>
            {others.length > 0 && (
              <div className="form-field pay-other">
                <label htmlFor="pay-other-reader">På läsare</label>
                <select id="pay-other-reader" value={other} onChange={(e) => setOther(e.target.value)}>
                  <option value="">{payment.readerLabel ?? 'Samma läsare'}</option>
                  {others.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}{r.status === 'offline' ? ' (offline)' : ''}</option>
                  ))}
                </select>
              </div>
            )}
            <button type="button" className="btn outline pay-big" disabled={busy} onClick={onNew}>
              Avbryt köpet
            </button>
          </>
        )}
        {(state === 'paid' || state === 'refunded') && (
          <>
            <button type="button" className="btn primary pay-big" onClick={onNew}>
              Ny betalning
            </button>
            <button type="button" className="btn outline pay-big" onClick={onReceipt}>
              <Icon name="receipt" size={18} /> Kvitto
            </button>
          </>
        )}
      </div>

      {payment.simulated && state === 'waiting' && (
        <div className="pay-simulate">
          <span className="cell-muted">Testläge, simulerad läsare:</span>
          <button type="button" className="btn outline" onClick={() => onSimulate('approve')}>Simulera kort</button>
          <button type="button" className="btn outline" onClick={() => onSimulate('decline')}>Simulera nekat</button>
        </div>
      )}
    </div>
  )
}

function ReceiptSlip({
  data,
  onClose,
  onSend,
}: {
  data: { payment: CardPayment; receipt: Receipt }
  onClose: () => void
  onSend: (email: string) => Promise<void>
}) {
  const { receipt: r } = data
  const ref = useRef<HTMLElement>(null)
  // En kolumn (mobil, surfplatta): kvittot hamnar under formuläret, så visa det.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [data])
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const heading = r.orderNumber ? `Beställning #${r.orderNumber}` : r.note || 'Kortbetalning'

  async function submit(event: FormEvent) {
    event.preventDefault()
    setState('sending')
    try {
      await onSend(email.trim())
      setState('sent')
      setMessage(`Kvittot skickas till ${email.trim()}.`)
      setEmail('')
    } catch (err) {
      setState('error')
      setMessage(errorText(err))
    }
  }

  return (
    <section ref={ref} className="admin-card pay-receipt" aria-label="Kvitto">
      <div className="receipt-slip">
        <p className="receipt-name">{r.seller.name}</p>
        {r.seller.org && <p>Org.nr {r.seller.org}</p>}
        {r.seller.address && <p>{r.seller.address}</p>}
        <p className="receipt-title">{r.title} · {heading}</p>
        <p>{r.when}</p>
        {r.lines.length > 0 && (
          <ul className="receipt-lines">
            {r.lines.map((line, i) => (
              <li key={i}><span>{line.quantity} x {line.name}</span><span>{kronor(line.total)}</span></li>
            ))}
          </ul>
        )}
        <p className="receipt-total"><span>Totalt</span><span>{kronor(r.total)}</span></p>
        {r.vat.map((v) => (
          <p key={v.rate} className="receipt-row"><span>Moms {v.rate} % (netto {kronor(v.net)})</span><span>{kronor(v.vat)}</span></p>
        ))}
        {r.vatOnRegister && <p className="receipt-small">Momsen redovisas på restaurangens kassakvitto.</p>}
        {r.refunded ? <p className="receipt-row"><span>Återbetalt</span><span>{kronor(r.refunded)}</span></p> : null}
        <p className="receipt-title">Kortbetalning, köp</p>
        {r.card.map((row) => (
          <p key={row.label} className="receipt-row"><span>{row.label}</span><span>{row.value}</span></p>
        ))}
        <p className="receipt-row"><span>Resultat</span><span>{r.result}</span></p>
        <p className="receipt-row"><span>Referens</span><span>{r.reference}</span></p>
      </div>

      <div className="pay-receipt-actions">
        <button type="button" className="btn outline" onClick={() => window.print()}>Skriv ut</button>
        <button type="button" className="btn outline" onClick={onClose}>
          <Icon name="close" size={16} /> Stäng
        </button>
      </div>
      <form className="pay-receipt-mail" onSubmit={(e) => void submit(e)}>
        <div className="form-field">
          <label htmlFor="receipt-email">Skicka kvitto till e-post</label>
          <input id="receipt-email" type="email" required autoComplete="off" placeholder="gast@exempel.se"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" className="btn primary" disabled={state === 'sending' || !email.trim()}>
          {state === 'sending' ? 'Skickar' : 'Skicka kvitto'}
        </button>
      </form>
      {message && (
        <p className={state === 'error' ? 'form-error' : 'save-notice'} role="status">{message}</p>
      )}
    </section>
  )
}
