import { useState } from 'react'
import type { FormEvent } from 'react'
import { SlotTablePicker } from './SlotTablePicker'
import { ChannelPicker } from './ChannelPicker'
import type { StaffChannel } from './ChannelPicker'
import type { SlotValue } from './SlotTablePicker'
import {
  EMAIL_MAX,
  NAME_MAX,
  NOTES_MAX,
  createErrorMessage,
  createManualReservation,
  isStaleSlotError,
  lastBookableDate,
  noCardOffer,
  phoneFieldError,
  staffPhone,
  validEmail,
} from './bookingsApi'
import type { Reservation } from './bookingsApi'
import { NotifyGuestCheck, StaffPhoneField } from './StaffBookingFields'
import ModalOverlay from '../../shared/ModalOverlay'
import { ErrorNote } from '../../shared/ErrorNote'
import { useUnsavedGuard } from '../../shared/unsaved'

/** Ett datum inom bokningsbara dagar (idag till och med idag + 21). */
function clampDate(date: string, today: string): string {
  const last = lastBookableDate(today)
  if (date < today) return today
  if (date > last) return last
  return date
}

/**
 * Telefonbokning eller drop-in, bokad av personalen. Båda följer samma
 * tider som gästerna (hel- och halvtimmar); en telefonbokning måste börja
 * minst 30 minuter fram, en drop-in bokas idag och får ta en pågående tid
 * eller en som börjar inom 30 minuter - gästen står ju redan där.
 *
 * En telefonbokning kräver gästens nummer och skickas med guarantee 'sms':
 * kräver bordet kortgaranti väntar bokningen på kort och Booqy skickar
 * kortlänken. Går sms:et inte kan personalen trycka Boka utan kort.
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
  const [source, setSource] = useState<StaffChannel>('phone')
  const [partySize, setPartySize] = useState('2')
  const [slot, setSlot] = useState<SlotValue>({
    date: clampDate(initialDate, today),
    startTime: '',
    tableIds: [],
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneTouched, setPhoneTouched] = useState(false)
  // Serverns svar om numret (visas vid fältet) och om Boka utan kort erbjuds.
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [noCard, setNoCard] = useState(false)
  // Senaste försöket var Boka utan kort: Försök igen gör samma sak igen.
  const [lastWaive, setLastWaive] = useState(false)
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const size = Number(partySize)
  const sizeOk = /^\d+$/.test(partySize) && size >= 1 && size <= 50
  const staff = staffPhone(source, phone, phoneTouched)
  const emailOk = !email.trim() || validEmail(email)
  const valid =
    sizeOk && name.trim() && slot.startTime && slot.tableIds.length > 0 && staff.ok && emailOk
  const canNotify = Boolean(phone.trim() || email.trim())
  // Ifyllt men inte bokat: adminen frågar innan man lämnar sidan. Boka kräver ett giltigt formulär.
  useUnsavedGuard(Boolean(name.trim() || phone.trim() || email.trim() || notes.trim() || slot.startTime))

  /** Svaret på förra försöket gäller inte längre (annan tid, bord, storlek eller kanal). */
  function clearAttempt() {
    setError(null)
    setPhoneError(null)
    setNoCard(false)
    setLastWaive(false)
  }

  function chooseSource(value: StaffChannel) {
    if (value === source) return
    setSource(value)
    setNotify(value === 'phone')
    clearAttempt()
    // Tiderna skiljer sig (drop-in: idag, även pågående tider) - välj om.
    setSlot((s) => ({ date: value === 'walk_in' ? today : s.date, startTime: '', tableIds: [] }))
  }

  function editPhone(value: string) {
    setPhone(value)
    setPhoneError(null)
    setNoCard(false)
    setLastWaive(false)
  }

  async function book(waive = false) {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    setPhoneError(null)
    setLastWaive(waive)
    try {
      const created = await createManualReservation(locationId, {
        date: slot.date,
        startTime: slot.startTime,
        tableIds: slot.tableIds,
        partySize: size,
        name: name.trim(),
        ...(staff.phone ? { phone: staff.phone } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        source,
        notifyGuest: canNotify && notify,
        ...(source === 'phone' ? { guarantee: waive ? ('waived' as const) : ('sms' as const) } : {}),
      })
      onCreated(created)
    } catch (err) {
      const atPhone = phoneFieldError(err)
      // Gick Boka utan kort inte står valet kvar (Försök igen bokar också utan kort).
      setNoCard(source === 'phone' && (waive || noCardOffer(err)))
      if (atPhone) {
        setPhoneError(atPhone)
        document.getElementById('nb-phone')?.focus()
      } else {
        setError(createErrorMessage(err))
        // Felrutan står sist i formuläret: visa den (i telefonen ligger den annars under knapparna).
        requestAnimationFrame(() => document.getElementById('nb-error')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
      }
      if (isStaleSlotError(err)) {
        // Tiden eller bordet gick inte längre: hämta om listan och välj om.
        setSlot((s) => ({ ...s, startTime: '', tableIds: [] }))
        setRefreshKey((n) => n + 1)
      }
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void book()
  }

  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal booking-modal" role="dialog" aria-modal="true" aria-label="Ny bokning">
        <h2>Ny bokning</h2>
        <form onSubmit={submit} className="booking-form">
          <ChannelPicker value={source} onChange={chooseSource} />

          <div className="form-field">
            <label htmlFor="nb-size">Antal personer</label>
            <input
              id="nb-size"
              inputMode="numeric"
              value={partySize}
              onChange={(e) => {
                setPartySize(e.target.value)
                clearAttempt()
              }}
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
              clearAttempt()
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
            <StaffPhoneField
              id="nb-phone"
              label={source === 'phone' ? <label htmlFor="nb-phone">Telefon</label> : <label htmlFor="nb-phone">Telefon (valfritt)</label>}
              value={phone}
              error={phoneError ?? staff.error}
              onChange={editPhone}
              onBlur={() => setPhoneTouched(true)}
            />
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
              {!emailOk && <p id="nb-email-error" className="field-hint error">E-postadressen ser fel ut. Skriv den så här: namn@exempel.se.</p>}
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
          {canNotify && <NotifyGuestCheck channel={source} checked={notify} onChange={setNotify} />}

          {error && (
            <ErrorNote id="nb-error" text={error} onRetry={valid ? () => void book(lastWaive) : undefined} />
          )}
          <div className={`modal-actions modal-actions--pinned${noCard ? ' has-no-card' : ''}`}>
            <button type="button" className="btn outline square" onClick={onCancel}>
              Avbryt
            </button>
            {noCard && (
              <button type="button" className="btn outline square no-card-btn" disabled={!valid || busy} onClick={() => void book(true)}>
                Boka utan kort
              </button>
            )}
            <button type="submit" className="btn primary square" disabled={!valid || busy}>
              {busy ? 'Bokar…' : 'Boka'}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  )
}
