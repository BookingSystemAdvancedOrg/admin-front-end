import { useState } from 'react'
import type { FormEvent } from 'react'
import { SlotTablePicker } from './SlotTablePicker'
import { createManualReservation, errorMessage } from './bookingsApi'
import type { Reservation } from './bookingsApi'

const PHONE = /^\+[1-9]\d{7,14}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Telefonbokning eller drop-in, bokad av personalen. */
export function NewReservationModal({
  locationId,
  initialDate,
  onCreated,
  onCancel,
}: {
  locationId: string
  initialDate: string
  onCreated: (r: Reservation) => void
  onCancel: () => void
}) {
  const [source, setSource] = useState<'phone' | 'walk_in'>('phone')
  const [partySize, setPartySize] = useState('2')
  const [slot, setSlot] = useState({ date: initialDate, startTime: '', tableIds: [] as string[] })
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const size = Number(partySize)
  const sizeOk = /^\d+$/.test(partySize) && size >= 1 && size <= 50
  const phoneOk = !phone.trim() || PHONE.test(phone.trim())
  const emailOk = !email.trim() || EMAIL.test(email.trim())
  const valid =
    sizeOk && name.trim() && slot.startTime && slot.tableIds.length > 0 && phoneOk && emailOk
  const canNotify = Boolean(phone.trim() || email.trim())

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
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        source,
        notifyGuest: canNotify && notify,
      })
      onCreated(created)
    } catch (err) {
      setError(errorMessage(err))
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
                onClick={() => {
                  setSource(value)
                  setNotify(value === 'phone')
                }}
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
            onChange={setSlot}
          />

          <div className="form-field">
            <label htmlFor="nb-name">Namn</label>
            <input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="nb-phone">Telefon (valfritt)</label>
              <input
                id="nb-phone"
                inputMode="tel"
                placeholder="+46701234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {!phoneOk && <p className="field-hint error">Skriv numret som +46701234567.</p>}
            </div>
            <div className="form-field">
              <label htmlFor="nb-email">E-post (valfritt)</label>
              <input
                id="nb-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {!emailOk && <p className="field-hint error">Ange en giltig e-postadress.</p>}
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="nb-notes">Anteckning (valfritt)</label>
            <textarea
              id="nb-notes"
              rows={2}
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
