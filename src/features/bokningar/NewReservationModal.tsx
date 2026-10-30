import { useState } from 'react'
import type { FormEvent } from 'react'
import { SlotTablePicker } from './SlotTablePicker'
import type { SlotValue } from './SlotTablePicker'
import {
  EMAIL_MAX,
  NAME_MAX,
  NOTES_MAX,
  addDays,
  createManualReservation,
  errorMessage,
  isStaleSlotError,
  normalizePhone,
  validEmail,
} from './bookingsApi'
import type { Reservation } from './bookingsApi'

/** Ett datum inom bokningsbara dagar (idag … idag + 20). */
function clampDate(date: string, today: string): string {
  const last = addDays(today, 20)
  if (date < today) return today
  if (date > last) return last
  return date
}

/**
 * Telefonbokning eller drop-in, bokad av personalen. Båda följer samma
 * tider som gästerna (hel- och halvtimmar); en telefonbokning måste börja
 * minst 30 minuter fram, en drop-in bokas idag och får ta en pågående tid
 * eller en som börjar inom 30 minuter - gästen står ju redan där.
 */
export function NewReservationModal({
  locationId,
  initialDate,
  today,
  onCreated,
  onCancel,
}: {
  locationId: string
  initialDate: string
  /** Dagens datum i platsens tidszon. */
  today: string
  onCreated: (r: Reservation) => void
  onCancel: () => void
}) {
  const [source, setSource] = useState<'phone' | 'walk_in'>('phone')
  const [partySize, setPartySize] = useState('2')
  const [slot, setSlot] = useState<SlotValue>({
    date: clampDate(initialDate, today),
    startTime: '',
    tableIds: [],
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const size = Number(partySize)
  const sizeOk = /^\d+$/.test(partySize) && size >= 1 && size <= 50
  const normalizedPhone = phone.trim() ? normalizePhone(phone) : null
  const phoneOk = !phone.trim() || normalizedPhone !== null
  const emailOk = !email.trim() || validEmail(email)
  const valid =
    sizeOk && name.trim() && slot.startTime && slot.tableIds.length > 0 && phoneOk && emailOk
  const canNotify = Boolean(phone.trim() || email.trim())

  function chooseSource(value: 'phone' | 'walk_in') {
    if (value === source) return
    setSource(value)
    setNotify(value === 'phone')
    setError(null)
    // Tiderna skiljer sig (drop-in: idag, även pågående tider) - välj om.
    setSlot((s) => ({ date: value === 'walk_in' ? today : s.date, startTime: '', tableIds: [] }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await createManualReservation(locationId, {
        date: slot.date,
        startTime: slot.startTime,
        tableIds: slot.tableIds,
        partySize: size,
        name: name.trim(),
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        source,
        notifyGuest: canNotify && notify,
      })
      onCreated(created)
    } catch (err) {
      setError(errorMessage(err))
      if (isStaleSlotError(err)) {
        // Tiden eller bordet gick inte längre: hämta om listan och välj om.
        setSlot((s) => ({ ...s, startTime: '', tableIds: [] }))
        setRefreshKey((n) => n + 1)
      }
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal booking-modal" role="dialog" aria-modal="true" aria-label="Ny bokning">
        <h2>Ny bokning</h2>
        <form onSubmit={submit} className="booking-form">
          <div className="segmented" role="radiogroup" aria-label="Typ av bokning">
            {(
              [
                ['phone', 'Telefon'],
                ['walk_in', 'Drop-in'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={source === value}
                className={source === value ? 'active' : ''}
                onClick={() => chooseSource(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="form-field">
            <label htmlFor="nb-size">Antal personer</label>
            <input
              id="nb-size"
              inputMode="numeric"
              value={partySize}
              onChange={(e) => setPartySize(e.target.value)}
            />
          </div>

          <SlotTablePicker
            locationId={locationId}
            date={slot.date}
            startTime={slot.startTime}
            tableIds={slot.tableIds}
            partySize={sizeOk ? size : 0}
            today={today}
            walkIn={source === 'walk_in'}
            refreshKey={refreshKey}
            onChange={(next) => {
              setSlot(next)
              setError(null)
            }}
          />

          <div className="form-field">
            <label htmlFor="nb-name">Namn</label>
            <input
              id="nb-name"
              maxLength={NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="nb-phone">Telefon (valfritt)</label>
              <input
                id="nb-phone"
                inputMode="tel"
                placeholder="070-123 45 67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={!phoneOk || undefined}
                aria-describedby={phoneOk ? undefined : 'nb-phone-error'}
              />
              {!phoneOk && <p id="nb-phone-error" className="field-hint error">Skriv ett giltigt nummer, t.ex. 070-123 45 67.</p>}
            </div>
            <div className="form-field">
              <label htmlFor="nb-email">E-post (valfritt)</label>
              <input
                id="nb-email"
                type="email"
                maxLength={EMAIL_MAX}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!emailOk || undefined}
                aria-describedby={emailOk ? undefined : 'nb-email-error'}
              />
              {!emailOk && <p id="nb-email-error" className="field-hint error">Ange en giltig e-postadress.</p>}
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="nb-notes">Anteckning (valfritt)</label>
            <textarea
              id="nb-notes"
              rows={2}
              maxLength={NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {canNotify && (
            <label className="check-row">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Skicka bekräftelse till gästen
            </label>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn outline square" onClick={onCancel}>
              Avbryt
            </button>
            <button type="submit" className="btn primary square" disabled={!valid || busy}>
              {busy ? 'Bokar…' : 'Boka'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
