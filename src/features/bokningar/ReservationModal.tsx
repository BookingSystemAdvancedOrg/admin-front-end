import { ChangedNote } from '../../shared/ChangedNote'
import { serverChanges } from '../../shared/merge'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { SlotTablePicker } from './SlotTablePicker'
import type { SlotValue } from './SlotTablePicker'
import {
  EMAIL_MAX,
  NAME_MAX,
  NOTES_MAX,
  OVERRIDABLE,
  SOURCE_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  availableActions,
  cardDeadline,
  changeStatus,
  clockLabel,
  dayLabel,
  errorMessage,
  formatKr,
  isStaleSlotError,
  normalizePhone,
  getReservation,
  paymentAction,
  resendGuaranteeLink,
  timestampLabel,
  updateReservation,
  validEmail,
  paymentFailureLabel,
} from './bookingsApi'
import type { HistoryEntry, Reservation, ReservationEdit } from './bookingsApi'
import { useBookingLabels } from '../../shared/bookingTables'
import { TableLinks } from '../../shared/TableLinks'
import { PhoneInput } from '../../shared/PhoneInput'
import { ApiError } from '../../shared/api'
import { minutesLabel } from '../installningar/bookingTime'
import ModalOverlay from '../../shared/ModalOverlay'
import { ErrorNote } from '../../shared/ErrorNote'
import { paidWithLabel } from '../../shared/paidWith'
import { Select } from '../../shared/Select'
import { RefundDialog } from '../../shared/RefundDialog'
import { BackButton } from '../../shared/BackButton'
import { useUnsavedGuard } from '../../shared/unsaved'

type Panel = null | 'no_show' | 'cancel' | 'edit' | 'extend'

/** Felrutans början när kortlänken inte gick att skicka igen (bokningen är orörd). */
const RESEND_FAILED = 'Länken skickades inte igen.'

const HISTORY_ACTION: Record<string, string> = {
  created: 'Bokad',
  edited: 'Ändrad',
  status: 'Status ändrad',
  cancelled: 'Avbokad av gästen',
  guarantee_confirmed: 'Kort sparat',
  expired: 'Kortet lades aldrig in - bordet släpptes',
  fee: 'Avgift',
  refund: 'Återbetalning',
  extended: 'Sluttid ändrad',
  shortened: 'Sluttid ändrad',
  link_resent: 'Kortlänk skickad igen',
  link_failed: 'Sms med kortlänk gick inte iväg, bordet släpptes',
  guarantee_waived: 'Kortgaranti hoppades över',
}

function who(by: string | undefined): string {
  if (!by) return ''
  if (by === 'guest') return 'gästen'
  if (by === 'stripe') return 'Stripe'
  if (by === 'system' || by === 'scheduler') return 'systemet'
  return 'personal'
}

/** Ändrade fält i historiken, på svenska. Interna fält (tider i UTC, ttl,
 * planversion m.m.) följer med en ändring men visas inte. */
const FIELD_LABEL: Record<string, string> = {
  date: 'tid',
  startTime: 'tid',
  endTime: 'tid',
  tableIds: 'bord',
  partySize: 'antal',
  customerName: 'namn',
  customerEmail: 'e-post',
  customerPhone: 'telefon',
  notes: 'meddelande',
}

function editedFieldsText(fields: unknown[]): string {
  const labels = fields.map((f) => (typeof f === 'string' ? FIELD_LABEL[f] : undefined)).filter(Boolean)
  return [...new Set(labels)].join(', ')
}

function historyText(h: HistoryEntry): string {
  const base = HISTORY_ACTION[h.action ?? ''] ?? h.action ?? ''
  const status = typeof h.status === 'string' ? STATUS_LABEL[h.status as keyof typeof STATUS_LABEL] : ''
  const amount = typeof h.amount === 'number' ? formatKr(h.amount) : ''
  const parts = [base]
  if (h.action === 'status' && status) parts[0] = status
  if (h.action === 'fee' && status) parts.push(`${status.toLowerCase()} ${amount}`.trim())
  if (h.action === 'refund' && amount) parts.push(amount)
  if (h.action === 'extended' || h.action === 'shortened') {
    parts.push(`${String(h.previous ?? '')} till ${String(h.endTime ?? '')}`)
    if (h.override) parts.push('utanför regeln')
  }
  if (h.action === 'edited' && Array.isArray(h.fields)) parts.push(editedFieldsText(h.fields))
  if (h.action === 'created' && h.cardSkipped) parts.push('utan kort (för nära starttiden)')
  if (typeof h.reason === 'string' && h.reason) parts.push(`"${h.reason}"`)
  return parts.filter(Boolean).join(' · ')
}

/** En bokning: uppgifter, historik och det personalen kan göra med den. */
export function ReservationModal({
  reservation,
  isOwner,
  today,
  onChanged,
  onClose,
}: {
  reservation: Reservation
  isOwner: boolean
  /** Dagens datum i platsens tidszon. */
  today: string
  onChanged: (r: Reservation) => void
  onClose: () => void
}) {
  const r = reservation
  const actions = availableActions(r, isOwner)
  const { labelsFor } = useBookingLabels(r.locationId, [r])
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chargeFee, setChargeFee] = useState(true)
  const [notifyGuest, setNotifyGuest] = useState(true)
  const [reason, setReason] = useState('')
  const [refunding, setRefunding] = useState(false)

  const noShowFee = r.cardOnFile ? (r.guarantee?.noShowFee ?? 0) : 0
  const canNotify = Boolean(r.customerEmail || r.customerPhone)
  // En bokning som väntar på kort har aldrig bekräftats: gästen får inget om avbokningen.
  const cancelNotify = canNotify && r.status !== 'pending'
  const link = r.guaranteeLink
  // Kortlänken syns bara när den faktiskt gick iväg: inte efter ett sms som
  // inte gick (bokningen släpptes) och inte på en bokning som inte väntar längre.
  const linkSent = Boolean(
    link?.textedAt &&
      (r.status === 'pending' || r.status === 'reserved') &&
      !r.history?.some((h) => h.action === 'link_failed'),
  )
  // Försök igen efter ett fel när länken skulle skickas igen skickar igen.
  const [retryResend, setRetryResend] = useState(false)

  function open(next: Panel) {
    setPanel(next)
    setError(null)
    setReason('')
  }

  async function run(action: () => Promise<Reservation>, failed?: string) {
    setBusy(true)
    setError(null)
    setRetryResend(false)
    try {
      const updated = await action()
      onChanged(updated)
      setPanel(null)
    } catch (err) {
      setError(errorMessage(err, failed))
      setRetryResend(failed === RESEND_FAILED)
      // 409 när länken skulle skickas igen (inte längre väntande, taket, tiden
      // eller någon annan hann före): texten lovar att det senaste syns.
      if (failed === RESEND_FAILED && err instanceof ApiError && err.status === 409) {
        await getReservation(r.locationId, r.reservationId).then(onChanged, () => {})
      }
    } finally {
      setBusy(false)
    }
  }

  const resend = () => run(() => resendGuaranteeLink(r.locationId, r.reservationId), RESEND_FAILED)

  const status = (s: 'arrived' | 'reserved' | 'no_show' | 'cancelled', opts = {}) =>
    run(() => changeStatus(r.locationId, r.reservationId, s, opts))

  const p = r.payment

  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* En bokning som går att flytta har bordskartan under Ändra: samma bredd från början. */}
      <div
        className={`modal booking-modal${actions.edit && r.status !== 'arrived' ? ' has-map' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Bokning"
      >
        <div className="booking-modal-head">
          <div>
            <h2>{r.customerName || 'Gäst'}</h2>
            <p className="cell-muted">
              {dayLabel(r.date)} · {r.startTime}-{r.endTime} · {r.partySize} pers · <TableLinks ids={r.tableIds} labels={labelsFor(r)} date={r.date} />
            </p>
          </div>
          <span className={`status-badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
        </div>

        {panel === 'edit' ? (
          <EditForm
            reservation={r}
            today={today}
            onSaved={(u) => {
              onChanged(u)
              setPanel(null)
            }}
            onCancel={() => setPanel(null)}
          />
        ) : (
          <>
            <dl className="booking-details">
              <dt>Telefon</dt>
              <dd>{r.customerPhone ? <a href={`tel:${r.customerPhone}`}>{r.customerPhone}</a> : '-'}</dd>
              <dt>E-post</dt>
              <dd>{r.customerEmail ? <a href={`mailto:${r.customerEmail}`}>{r.customerEmail}</a> : '-'}</dd>
              <dt>Källa</dt>
              <dd>{r.source ? SOURCE_LABEL[r.source] : '-'}</dd>
              {r.bookingRule && (
                <>
                  <dt>Bokningstid</dt>
                  <dd>{ruleText(r)}</dd>
                </>
              )}
              {r.notes && (
                <>
                  <dt>Meddelande</dt>
                  <dd className="booking-notes">{r.notes}</dd>
                </>
              )}
              {r.guarantee && (
                <>
                  <dt>Kortgaranti</dt>
                  <dd>
                    {r.cardOnFile
                      ? (paidWithLabel(r.guaranteeCard) ?? 'Kort sparat')
                      : r.status === 'pending' ? 'Väntar på kort' : 'Inget kort'}
                    {' · '}no-show {formatKr(r.guarantee.noShowFee)}
                    {r.guarantee.lateCancelFee
                      ? ` · sen avbokning ${formatKr(r.guarantee.lateCancelFee)} (inom ${r.guarantee.cancelCutoffHours} h)`
                      : ''}
                  </dd>
                </>
              )}
              {r.status === 'pending' && r.pendingExpiresAt && (
                <>
                  <dt>Hålls till</dt>
                  <dd>{timestampLabel(cardDeadline(r), r.timezone)}</dd>
                </>
              )}
              {linkSent && link?.textedAt && (
                <>
                  <dt>Kortlänk</dt>
                  <dd>
                    Skickad {clockLabel(link.textedAt, r.timezone)}
                    {(link.sends ?? 1) > 1 ? ` · ${link.sends} sms` : ''}
                  </dd>
                </>
              )}
              {p?.amount ? (
                <>
                  <dt>Avgift</dt>
                  <dd>
                    {p.kind === 'late_cancel' ? 'Sen avbokning' : 'No-show'} {formatKr(p.amount)} ·{' '}
                    {p.status === 'succeeded'
                      ? 'dragen'
                      : p.status === 'failed'
                        ? `drogs inte${paymentFailureLabel(p.error) ? ` (${paymentFailureLabel(p.error)})` : ''}`
                        : p.status === 'refunded'
                          ? 'återbetald'
                          : 'pågår'}
                    {p.refundedAmount ? ` · återbetalt ${formatKr(p.refundedAmount)}` : ''}
                  </dd>
                </>
              ) : null}
            </dl>

            {panel === null && (
              <div className="booking-actions">
                {actions.resend && (
                  <button
                    type="button"
                    className="btn primary square"
                    disabled={busy}
                    onClick={() => void resend()}
                  >
                    {busy ? 'Skickar…' : 'Skicka länken igen'}
                  </button>
                )}
                {actions.arrive && (
                  <button type="button" className="btn primary square" disabled={busy} onClick={() => status('arrived')}>
                    {r.status === 'no_show' ? 'Gästen kom ändå' : 'Anlänt'}
                  </button>
                )}
                {actions.undoArrive && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => status('reserved')}>
                    Ångra anlänt
                  </button>
                )}
                {actions.edit && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => open('edit')}>
                    Ändra
                  </button>
                )}
                {actions.extend && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => open('extend')}>
                    Förläng
                  </button>
                )}
                {actions.noShow && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => open('no_show')}>
                    Uteblev
                  </button>
                )}
                {actions.retryCharge && (
                  <button
                    type="button"
                    className={`btn ${actions.arrive ? 'outline' : 'primary'} square`}
                    disabled={busy}
                    onClick={() => run(() => paymentAction(r.locationId, r.reservationId, 'charge'))}
                  >
                    {busy ? 'Debiterar…' : 'Debitera avgiften igen'}
                  </button>
                )}
                {actions.refund && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => setRefunding(true)}>
                    Återbetala
                  </button>
                )}
                {actions.cancel && (
                  <button type="button" className="btn danger-outline square" disabled={busy} onClick={() => open('cancel')}>
                    Avboka
                  </button>
                )}
              </div>
            )}

            {panel === 'no_show' && (
              <div className="booking-panel">
                <p className="form-section-label">Markera som utebliven</p>
                <p className="cell-muted">Borden släpps direkt.</p>
                {noShowFee > 0 && (
                  <label className="check-row">
                    <input type="checkbox" checked={chargeFee} onChange={(e) => setChargeFee(e.target.checked)} />
                    Debitera no-show-avgiften {formatKr(noShowFee)} från gästens kort
                  </label>
                )}
                <ReasonField value={reason} onChange={setReason} />
                <PanelButtons
                  busy={busy}
                  label={noShowFee > 0 && chargeFee ? `Uteblev - debitera ${formatKr(noShowFee)}` : 'Uteblev'}
                  onCancel={() => setPanel(null)}
                  onConfirm={() =>
                    status('no_show', {
                      ...(noShowFee > 0 ? { chargeFee } : {}),
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                    })
                  }
                />
              </div>
            )}

            {panel === 'extend' && (
              <ExtendPanel
                reservation={r}
                onSaved={(u) => {
                  onChanged(u)
                  setPanel(null)
                }}
                onCancel={() => setPanel(null)}
              />
            )}

            {panel === 'cancel' && (
              <div className="booking-panel">
                <p className="form-section-label">Avboka bokningen</p>
                <p className="cell-muted">Borden släpps. Gästen debiteras inte.</p>
                {cancelNotify && (
                  <label className="check-row">
                    <input type="checkbox" checked={notifyGuest} onChange={(e) => setNotifyGuest(e.target.checked)} />
                    Meddela gästen
                  </label>
                )}
                <ReasonField value={reason} onChange={setReason} />
                <PanelButtons
                  busy={busy}
                  danger
                  label="Avboka"
                  onCancel={() => setPanel(null)}
                  onConfirm={() =>
                    status('cancelled', {
                      notifyGuest: cancelNotify && notifyGuest,
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                    })
                  }
                />
              </div>
            )}

            {refunding && (
              <RefundDialog
                title="Återbetala avgiften"
                remaining={actions.refundable}
                canNotify={canNotify}
                onRefund={async (input) => {
                  try {
                    onChanged(await paymentAction(r.locationId, r.reservationId, 'refund', input))
                  } catch (err) {
                    // Det senaste beloppet i dialogen (t.ex. efter 409).
                    await getReservation(r.locationId, r.reservationId).then(onChanged, () => {})
                    throw err
                  }
                }}
                onDone={() => setRefunding(false)}
                onClose={() => setRefunding(false)}
              />
            )}

            {error && (
              <ErrorNote text={error} onRetry={retryResend && actions.resend ? () => void resend() : undefined} />
            )}

            {r.history && r.history.length > 0 && (
              <details className="booking-history">
                <summary>Historik</summary>
                <ol>
                  {[...r.history].reverse().map((h, i) => (
                    <li key={i}>
                      <span className="cell-muted">{timestampLabel(h.at, r.timezone)}</span> {historyText(h)}
                      {who(h.by) && <span className="cell-muted"> · {who(h.by)}</span>}
                    </li>
                  ))}
                </ol>
              </details>
            )}

            <div className="modal-actions">
              <button type="button" className="btn outline square" onClick={onClose}>
                Stäng
              </button>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

const toMinute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
const toClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** "1 tim 30 min (Lunchbuffé) · kan förlängas 30 min" */
function ruleText(r: Reservation): string {
  const rule = r.bookingRule
  if (!rule) return ''
  const own = toMinute(r.endTime) - toMinute(r.startTime)
  const name = rule.name ? ` (${rule.name})` : ''
  const ext = rule.extensionAllowed ? `kan förlängas ${minutesLabel(rule.maxExtensionMinutes)}` : 'kan inte förlängas'
  const changed = own !== rule.durationMinutes ? ` · nu ${minutesLabel(own)}` : ''
  return `${minutesLabel(rule.durationMinutes)}${name} · ${ext}${changed}`
}

/**
 * Personalen ändrar sluttiden (förlänger eller kortar) i kvartssteg. Längre
 * än regeln tillåter kräver ett aktivt "förläng ändå" (loggas). Servern
 * kontrollerar borden, stängningstiden och regeln igen.
 */
function ExtendPanel({
  reservation: r,
  onSaved,
  onCancel,
}: {
  reservation: Reservation
  onSaved: (r: Reservation) => void
  onCancel: () => void
}) {
  const rule = r.bookingRule ?? { durationMinutes: toMinute(r.endTime) - toMinute(r.startTime), extensionAllowed: false, maxExtensionMinutes: 0 }
  const start = toMinute(r.startTime)
  const current = toMinute(r.endTime)
  const allowedEnd = start + rule.durationMinutes + (rule.extensionAllowed ? rule.maxExtensionMinutes : 0)
  const last = Math.min(23 * 60 + 45, Math.max(current, allowedEnd) + 120)
  const options: number[] = []
  for (let m = start + 15; m <= last; m += 15) options.push(m)
  if (!options.includes(current)) options.push(current)
  options.sort((a, b) => a - b)
  const [end, setEnd] = useState(() => Math.min(Math.max(current, allowedEnd), last))
  const [override, setOverride] = useState(false)
  const [serverSaysOverride, setServerSaysOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const beyondRule = end > current && end > allowedEnd
  const needsOverride = beyondRule || serverSaysOverride

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || end === current) return
    if (needsOverride && !override) {
      setError('Kryssa i rutan för att förlänga mer än regeln tillåter.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSaved(
        await updateReservation(r.locationId, r.reservationId, {
          endTime: toClock(end),
          ...(needsOverride ? { overrideRule: true } : {}),
        }),
      )
    } catch (err) {
      setError(errorMessage(err))
      if (err instanceof ApiError && OVERRIDABLE.includes(err.message)) setServerSaysOverride(true)
      setBusy(false)
    }
  }

  return (
    <form className="booking-panel" onSubmit={submit}>
      <p className="form-section-label">Ändra sluttid</p>
      <p className="cell-muted">
        Nu {r.startTime}-{r.endTime}. {rule.extensionAllowed
          ? `Max ${toClock(allowedEnd)}.`
          : 'Ingen förlängning enligt regeln.'}
      </p>
      <div className="form-field">
        <label htmlFor="extend-end">Ny sluttid</label>
        <Select
          id="extend-end"
          value={end}
          onChange={(e) => {
            setEnd(Number(e.target.value))
            setServerSaysOverride(false)
            setOverride(false)
            setError(null)
          }}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {toClock(m)}
              {m === current ? ', nu' : m > current && m > allowedEnd ? ', över regeln' : `, ${minutesLabel(m - start)}`}
            </option>
          ))}
        </Select>
      </div>
      {needsOverride && (
        <label className="check-row">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Förläng ändå, utöver bokningens regel (sparas i historiken)
        </label>
      )}
      {error && (
        <ErrorNote text={error} />
      )}
      <div className="modal-actions">
        <BackButton onClick={onCancel} />
        <button type="submit" className="btn primary square" disabled={busy || end === current}>
          {busy ? 'Sparar…' : end < current ? 'Korta bokningen' : 'Förläng'}
        </button>
      </div>
    </form>
  )
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="form-field">
      <label htmlFor="status-reason">Intern anteckning (valfri)</label>
      <input id="status-reason" maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function PanelButtons({
  busy,
  label,
  danger,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  label: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-actions">
      <BackButton onClick={onCancel} />
      <button
        type="button"
        className={`btn ${danger ? 'danger-outline' : 'primary'} square`}
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? 'Sparar…' : label}
      </button>
    </div>
  )
}

function EditForm({
  reservation: latest,
  today,
  onSaved,
  onCancel,
}: {
  reservation: Reservation
  today: string
  onSaved: (r: Reservation) => void
  onCancel: () => void
}) {
  // Bokningen som formuläret öppnades med: bara det du ändrar mot den skickas,
  // så en ändring en kollega gjort under tiden (listan är levande) står kvar.
  const [r] = useState(latest)
  const drift = serverChanges(r, latest, ['customerName', 'customerPhone', 'customerEmail', 'notes', 'partySize'])
  const [name, setName] = useState(r.customerName ?? '')
  const [phone, setPhone] = useState(r.customerPhone ?? '')
  const [email, setEmail] = useState(r.customerEmail ?? '')
  const [notes, setNotes] = useState(r.notes ?? '')
  const [partySize, setPartySize] = useState(String(r.partySize))
  const [slot, setSlot] = useState<SlotValue>({ date: r.date, startTime: r.startTime, tableIds: r.tableIds })
  const [refreshKey, setRefreshKey] = useState(0)
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Onlinebokningar måste ha e-post och telefon (gästen fick länken dit).
  const contactRequired = r.source === 'online'
  const size = Number(partySize)
  const sizeOk = /^\d+$/.test(partySize) && size >= 1 && size <= 50
  const normalizedPhone = phone.trim() ? normalizePhone(phone) : null
  const phoneOk = phone.trim() ? normalizedPhone !== null : !contactRequired
  const emailOk = email.trim() ? validEmail(email) : !contactRequired
  const arrived = r.status === 'arrived'
  // En anländ gäst sitter redan: fler gäster än borden rymmer kräver bordsbyte.
  const overSeats = arrived && typeof r.seats === 'number' && size > r.seats
  const moved = slot.date !== r.date || slot.startTime !== r.startTime
  const tablesChanged = [...slot.tableIds].sort().join() !== [...r.tableIds].sort().join()

  function changes(): ReservationEdit {
    const edit: ReservationEdit = {}
    if (name.trim() !== (r.customerName ?? '')) edit.name = name.trim()
    if ((normalizedPhone ?? '') !== (r.customerPhone ?? '')) edit.phone = normalizedPhone
    if (email.trim().toLowerCase() !== (r.customerEmail ?? '')) edit.email = email.trim() || null
    if (notes.trim() !== (r.notes ?? '')) edit.notes = notes.trim() || null
    if (size !== r.partySize) edit.partySize = size
    if (!arrived) {
      if (slot.date !== r.date) edit.date = slot.date
      if (slot.startTime !== r.startTime) edit.startTime = slot.startTime
      if (moved || tablesChanged) edit.tableIds = slot.tableIds
      if (moved) edit.notifyGuest = notify
    }
    return edit
  }

  const edit = changes()
  // Spara följer ändringarna: avstängd tills något skiljer sig från bokningen.
  const dirty = Object.keys(edit).some((k) => k !== 'notifyGuest')
  useUnsavedGuard(dirty)
  const valid =
    sizeOk &&
    !overSeats &&
    name.trim() &&
    phoneOk &&
    emailOk &&
    (arrived || (slot.startTime && slot.tableIds.length > 0))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy || !dirty) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await updateReservation(r.locationId, r.reservationId, edit))
    } catch (err) {
      setError(errorMessage(err))
      if (isStaleSlotError(err)) {
        // Den nya tiden/bordet gick inte längre: tillbaka till bokningens egen
        // tid och hämta om listan.
        setSlot({ date: r.date, startTime: r.startTime, tableIds: r.tableIds })
        setRefreshKey((n) => n + 1)
      }
      setBusy(false)
    }
  }

  return (
    <form className="booking-form" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="ed-name">Namn</label>
        <input id="ed-name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        {drift.customerName !== undefined && (drift.customerName ?? '') !== name.trim() && (
          <ChangedNote value={drift.customerName ?? ''} onUse={() => setName(drift.customerName ?? '')} />
        )}
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="ed-phone">Telefon{contactRequired ? '' : ' (valfritt)'}</label>
          <PhoneInput
            id="ed-phone"
            value={phone}
            onChange={setPhone}
            aria-invalid={!phoneOk || undefined}
            aria-describedby={phoneOk ? undefined : 'ed-phone-error'}
          />
          {!phoneOk && (
            <p id="ed-phone-error" className="field-hint error">
              {phone.trim() ? 'Numret ser fel ut. Skriv det så här: 070 123 45 67.' : 'En onlinebokning behöver ett telefonnummer. Skriv till exempel 070 123 45 67.'}
            </p>
          )}
          {drift.customerPhone !== undefined && (drift.customerPhone ?? '') !== (normalizedPhone ?? '') && (
            <ChangedNote value={drift.customerPhone ?? ''} onUse={() => setPhone(drift.customerPhone ?? '')} />
          )}
        </div>
        <div className="form-field">
          <label htmlFor="ed-email">E-post{contactRequired ? '' : ' (valfritt)'}</label>
          <input
            id="ed-email"
            type="email"
            maxLength={EMAIL_MAX}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!emailOk || undefined}
            aria-describedby={emailOk ? undefined : 'ed-email-error'}
          />
          {!emailOk && (
            <p id="ed-email-error" className="field-hint error">
              {email.trim() ? 'E-postadressen ser fel ut. Skriv den så här: namn@exempel.se.' : 'En onlinebokning behöver en e-postadress. Skriv till exempel namn@exempel.se.'}
            </p>
          )}
          {drift.customerEmail !== undefined && (drift.customerEmail ?? '') !== email.trim().toLowerCase() && (
            <ChangedNote value={drift.customerEmail ?? ''} onUse={() => setEmail(drift.customerEmail ?? '')} />
          )}
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="ed-size">Antal personer</label>
        <input
          id="ed-size"
          inputMode="numeric"
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
          aria-invalid={overSeats || undefined}
          aria-describedby={overSeats ? 'ed-size-error' : undefined}
        />
        {overSeats && (
          <p id="ed-size-error" className="field-hint error">
            Borden har bara {r.seats} platser. Ångra Anlänt först, sedan kan du byta till större bord.
          </p>
        )}
        {drift.partySize !== undefined && drift.partySize !== size && (
          <ChangedNote value={`${drift.partySize} personer`} onUse={() => setPartySize(String(drift.partySize))} />
        )}
      </div>
      {!arrived && (
        <SlotTablePicker
          locationId={r.locationId}
          date={slot.date}
          startTime={slot.startTime}
          tableIds={slot.tableIds}
          partySize={sizeOk ? size : 0}
          today={today}
          walkIn={r.source === 'walk_in'}
          refreshKey={refreshKey}
          keep={{ date: r.date, startTime: r.startTime, tableIds: r.tableIds, seats: r.seats }}
          onChange={(next) => {
            setSlot(next)
            setError(null)
          }}
        />
      )}
      <div className="form-field">
        <label htmlFor="ed-notes">Meddelande / anteckning</label>
        <textarea id="ed-notes" rows={2} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {drift.notes !== undefined && (drift.notes ?? '') !== notes.trim() && (
          <ChangedNote value={drift.notes ?? ''} onUse={() => setNotes(drift.notes ?? '')} />
        )}
      </div>
      {moved && (r.customerEmail || r.customerPhone) && (
        <label className="check-row">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Meddela gästen om den nya tiden
        </label>
      )}
      {error && (
        <ErrorNote text={error} />
      )}
      <div className="modal-actions modal-actions--pinned">
        <BackButton onClick={onCancel} />
        <button type="submit" className="btn primary square" disabled={!dirty || !valid || busy}>
          {busy ? 'Sparar…' : error ? 'Spara igen' : 'Spara'}
        </button>
      </div>
    </form>
  )
}
