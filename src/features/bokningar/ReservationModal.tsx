import { useState } from 'react'
import type { FormEvent } from 'react'
import { SlotTablePicker } from './SlotTablePicker'
import type { SlotValue } from './SlotTablePicker'
import {
  EMAIL_MAX,
  NAME_MAX,
  NOTES_MAX,
  SOURCE_LABEL,
  STATUS_CLASS,
  STATUS_LABEL,
  availableActions,
  changeStatus,
  dayLabel,
  errorMessage,
  formatKr,
  isStaleSlotError,
  normalizePhone,
  paymentAction,
  timestampLabel,
  updateReservation,
  validEmail,
} from './bookingsApi'
import type { HistoryEntry, Reservation, ReservationEdit } from './bookingsApi'
import { tableNames, useTables } from '../../shared/tables'
import { PhoneInput } from '../../shared/PhoneInput'

type Panel = null | 'no_show' | 'cancel' | 'refund' | 'edit'

const HISTORY_ACTION: Record<string, string> = {
  created: 'Bokad',
  edited: 'Ändrad',
  status: 'Status ändrad',
  cancelled: 'Avbokad av gästen',
  guarantee_confirmed: 'Kort sparat',
  expired: 'Kortet lades aldrig in - bordet släpptes',
  fee: 'Avgift',
  refund: 'Återbetalning',
}

function who(by: string | undefined): string {
  if (!by) return ''
  if (by === 'guest') return 'gästen'
  if (by === 'stripe') return 'Stripe'
  if (by === 'system' || by === 'scheduler') return 'systemet'
  return 'personal'
}

function historyText(h: HistoryEntry): string {
  const base = HISTORY_ACTION[h.action ?? ''] ?? h.action ?? ''
  const status = typeof h.status === 'string' ? STATUS_LABEL[h.status as keyof typeof STATUS_LABEL] : ''
  const amount = typeof h.amount === 'number' ? formatKr(h.amount) : ''
  const parts = [base]
  if (h.action === 'status' && status) parts[0] = status
  if (h.action === 'fee' && status) parts.push(`${status.toLowerCase()} ${amount}`.trim())
  if (h.action === 'refund' && amount) parts.push(amount)
  if (h.action === 'edited' && Array.isArray(h.fields)) parts.push((h.fields as string[]).join(', '))
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
  const { labels } = useTables(r.locationId)
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chargeFee, setChargeFee] = useState(true)
  const [notifyGuest, setNotifyGuest] = useState(true)
  const [reason, setReason] = useState('')
  const [refundKr, setRefundKr] = useState(String(actions.refundable / 100))

  const noShowFee = r.cardOnFile ? (r.guarantee?.noShowFee ?? 0) : 0
  const canNotify = Boolean(r.customerEmail || r.customerPhone)

  function open(next: Panel) {
    setPanel(next)
    setError(null)
    setReason('')
  }

  async function run(action: () => Promise<Reservation>) {
    setBusy(true)
    setError(null)
    try {
      const updated = await action()
      onChanged(updated)
      setPanel(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const status = (s: 'arrived' | 'reserved' | 'no_show' | 'cancelled', opts = {}) =>
    run(() => changeStatus(r.locationId, r.reservationId, s, opts))

  function submitRefund(e: FormEvent) {
    e.preventDefault()
    const ore = Math.round(Number(refundKr.replace(',', '.')) * 100)
    if (!Number.isFinite(ore) || ore < 1 || ore > actions.refundable) {
      setError(`Ange ett belopp mellan 0,01 och ${formatKr(actions.refundable)}.`)
      return
    }
    void run(() => paymentAction(r.locationId, r.reservationId, 'refund', ore))
  }

  const p = r.payment

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal booking-modal" role="dialog" aria-modal="true" aria-label="Bokning">
        <div className="booking-modal-head">
          <div>
            <h2>{r.customerName || 'Gäst'}</h2>
            <p className="cell-muted">
              {dayLabel(r.date)} · {r.startTime}-{r.endTime} · {r.partySize} pers · {tableNames(r.tableIds, labels)}
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
                    {r.cardOnFile ? 'Kort sparat' : r.status === 'pending' ? 'Väntar på kort' : 'Inget kort'}
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
                  <dd>{timestampLabel(r.pendingExpiresAt, r.timezone)}</dd>
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
                        ? `misslyckades${p.error ? ` (${p.error})` : ''}`
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
                {actions.noShow && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => open('no_show')}>
                    Uteblev
                  </button>
                )}
                {actions.retryCharge && (
                  <button
                    type="button"
                    className="btn primary square"
                    disabled={busy}
                    onClick={() => run(() => paymentAction(r.locationId, r.reservationId, 'charge'))}
                  >
                    {busy ? 'Debiterar…' : 'Debitera avgiften igen'}
                  </button>
                )}
                {actions.refund && (
                  <button type="button" className="btn outline square" disabled={busy} onClick={() => open('refund')}>
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

            {panel === 'cancel' && (
              <div className="booking-panel">
                <p className="form-section-label">Avboka bokningen</p>
                <p className="cell-muted">Borden släpps. Gästen debiteras inte.</p>
                {canNotify && (
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
                      notifyGuest: canNotify && notifyGuest,
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                    })
                  }
                />
              </div>
            )}

            {panel === 'refund' && (
              <form className="booking-panel" onSubmit={submitRefund}>
                <p className="form-section-label">Återbetala avgiften</p>
                <div className="form-field">
                  <label htmlFor="refund-amount">Belopp (kr), högst {formatKr(actions.refundable)}</label>
                  <input
                    id="refund-amount"
                    inputMode="decimal"
                    value={refundKr}
                    onChange={(e) => setRefundKr(e.target.value)}
                  />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn outline square" onClick={() => setPanel(null)}>
                    Tillbaka
                  </button>
                  <button type="submit" className="btn primary square" disabled={busy}>
                    {busy ? 'Återbetalar…' : 'Återbetala'}
                  </button>
                </div>
              </form>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
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
    </div>
  )
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="form-field">
      <label htmlFor="status-reason">Intern anteckning (valfritt, visas inte för gästen)</label>
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
      <button type="button" className="btn outline square" onClick={onCancel}>
        Tillbaka
      </button>
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
  reservation: r,
  today,
  onSaved,
  onCancel,
}: {
  reservation: Reservation
  today: string
  onSaved: (r: Reservation) => void
  onCancel: () => void
}) {
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
  const valid =
    sizeOk &&
    !overSeats &&
    name.trim() &&
    phoneOk &&
    emailOk &&
    (arrived || (slot.startTime && slot.tableIds.length > 0))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    if (Object.keys(edit).length === 0) {
      onCancel()
      return
    }
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
      </div>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="ed-phone">Telefon{contactRequired ? '' : ' (valfritt)'}</label>
          <PhoneInput id="ed-phone" value={phone} onChange={setPhone} />
          {!phoneOk && (
            <p className="field-hint error">
              {phone.trim() ? 'Skriv ett giltigt nummer, t.ex. 070-123 45 67.' : 'En onlinebokning måste ha telefon.'}
            </p>
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
          />
          {!emailOk && (
            <p className="field-hint error">
              {email.trim() ? 'Ange en giltig e-postadress.' : 'En onlinebokning måste ha e-post.'}
            </p>
          )}
        </div>
      </div>
      <div className="form-field">
        <label htmlFor="ed-size">Antal personer</label>
        <input id="ed-size" inputMode="numeric" value={partySize} onChange={(e) => setPartySize(e.target.value)} />
        {overSeats && (
          <p className="field-hint error">
            Borden rymmer {r.seats} - ångra Anlänt först för att byta till större bord.
          </p>
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
      </div>
      {moved && (r.customerEmail || r.customerPhone) && (
        <label className="check-row">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Meddela gästen om den nya tiden
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn outline square" onClick={onCancel}>
          Tillbaka
        </button>
        <button type="submit" className="btn primary square" disabled={!valid || busy}>
          {busy ? 'Sparar…' : 'Spara'}
        </button>
      </div>
    </form>
  )
}
