import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { isApiConfigured } from '../../shared/api'
import { Loading } from '../../shared/Loading'
import { currentLocation, useTenant } from '../../shared/tenant'
import { ChannelPicker } from '../bokningar/ChannelPicker'
import type { StaffChannel } from '../bokningar/ChannelPicker'
import {
  EMAIL_MAX,
  NAME_MAX,
  NOTES_MAX,
  cardDeadline,
  clockLabel,
  createErrorMessage,
  createManualReservation,
  dayNotice,
  errorMessage,
  LOCATION_NOT_BOOKABLE,
  getAvailability,
  isStaleSlotError,
  lastBookableDate,
  noCardOffer,
  phoneFieldError,
  staffPhone,
  todayIn,
  validEmail,
} from '../bokningar/bookingsApi'
import type { AvailabilitySlot, DayStatus } from '../bokningar/bookingsApi'
import { NotifyGuestCheck, StaffPhoneField } from '../bokningar/StaffBookingFields'
import { SLOT_REFRESH_MS } from '../bokningar/SlotTablePicker'
import { DateInput } from '../../shared/DateInput'
import { loadActiveLayout } from './activeLayout'
import type { ActivePlan } from './activeLayout'
import type { TableElement } from './data'
import { FloorMap, FloorTabs } from './FloorMap'
import type { TableView } from './FloorMap'
import '../bokningar/bokningar.css'
import './floor-booking.css'
import { ErrorNote } from '../../shared/ErrorNote'

/**
 * Boka direkt från bordskartan: personalen trycker på ett ledigt bord, ser
 * dess platser och lediga tider, väljer hur gästen bokade (telefon eller
 * drop-in) och fyller i gästen. Planen är den publicerade, gällande (samma
 * bord-id och "Bord 3" som gästerna ser). Bokningen går genom samma
 * POST /reservations som Bokningar, så servern prövar tiden och bordet
 * igen och nekar en dubbelbokning (409), varpå tiderna hämtas om.
 */
export function FloorBooking({
  actions,
  notice,
  focus,
}: {
  actions?: ReactNode
  notice?: ReactNode
  /** Bordet att markera (länk "Bord 3" från Bokningar, Översikt eller Kön) och dagen. */
  focus?: { tableIds: string[]; date: string | null } | null
}) {
  const tenantState = useTenant()
  const { locationId } = tenantState
  const location = currentLocation(tenantState)
  const today = todayIn(location?.timezone)
  const [plan, setPlan] = useState<ActivePlan | null>(null)
  // Vilken plats planen hämtades för, och hur det gick.
  const [planFor, setPlanFor] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [floorId, setFloorId] = useState<string | null>(null)

  const [channel, setChannel] = useState<StaffChannel>('phone')
  const [date, setDate] = useState(today)
  const [partySize, setPartySize] = useState('2')
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [day, setDay] = useState<DayStatus | null>(null)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const [tableId, setTableId] = useState<string | null>(null)
  const [startTime, setStartTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [noCard, setNoCard] = useState(false)
  // Senaste försöket var Boka utan kort: Försök igen gör samma sak igen.
  const [lastWaive, setLastWaive] = useState(false)
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLElement>(null)
  // Bordet som länken pekade på blinkar till en kort stund; vilket fokus som redan visats.
  const [flashIds, setFlashIds] = useState<string[]>([])
  // Bokningens bord ligger kvar markerade tills personalen väljer ett bord själv.
  const [linkedIds, setLinkedIds] = useState<string[]>([])
  const [focusDone, setFocusDone] = useState<string | null>(null)

  const canLoad = Boolean(locationId) && isApiConfigured()
  useEffect(() => {
    if (!locationId || !canLoad) return
    let live = true
    loadActiveLayout(locationId).then(
      (p) => {
        if (!live) return
        setPlan(p)
        setPlanError(null)
        setFloorId(p?.floors.find((f) => f.tables.length > 0)?.id ?? p?.floors[0]?.id ?? null)
        setPlanFor(locationId)
      },
      (err) => {
        if (!live) return
        setPlan(null)
        setPlanError(errorMessage(err, 'Bordskartan kunde inte visas.', LOCATION_NOT_BOOKABLE))
        setPlanFor(locationId)
      },
    )
    return () => {
      live = false
    }
  }, [locationId, canLoad])
  const planState: 'loading' | 'ready' | 'none' | 'error' = !canLoad
    ? 'none'
    : planFor !== locationId
      ? 'loading'
      : planError
        ? 'error'
        : plan && plan.floors.some((f) => f.tables.length > 0)
          ? 'ready'
          : 'none'

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), SLOT_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  const walkIn = channel === 'walk_in'
  const slotsKey = `${locationId}|${date}|${walkIn}`
  const [slotsFor, setSlotsFor] = useState<string | null>(null)
  useEffect(() => {
    if (!locationId || planState !== 'ready') return
    let live = true
    getAvailability(locationId, date, { walkIn }).then(
      (r) => {
        if (!live) return
        setSlots(r.slots)
        setDay(r.day)
        setSlotsError(null)
        setSlotsFor(slotsKey)
      },
      (err) => {
        if (!live) return
        setSlots([])
        setDay(null)
        setSlotsError(errorMessage(err, 'De lediga tiderna kunde inte visas.', LOCATION_NOT_BOOKABLE))
        setSlotsFor(slotsKey)
      },
    )
    return () => {
      live = false
    }
  }, [locationId, date, walkIn, planState, tick, slotsKey])
  const slotsLoading = slotsFor !== slotsKey

  /** Lediga tider per bord den valda dagen. */
  const freeTimes = useMemo(() => {
    const map = new Map<string, string[]>()
    if (slotsLoading) return map
    for (const s of slots ?? []) {
      for (const t of s.tables) {
        const list = map.get(t.tableId) ?? []
        list.push(s.startTime)
        map.set(t.tableId, list)
      }
    }
    for (const list of map.values()) list.sort()
    return map
  }, [slots, slotsLoading])

  const floor = plan?.floors.find((f) => f.id === floorId) ?? plan?.floors[0] ?? null
  const allTables = plan?.floors.flatMap((f) => f.tables) ?? []
  const table = allTables.find((t) => t.id === tableId) ?? null
  const label = (t: TableElement) => plan?.labels.get(t.id) ?? t.label
  const linked = allTables.filter((t) => linkedIds.includes(t.id))

  // Länkens bord: rätt våning, rätt dag (inom bokningsfönstret), markerat och i bild.
  const focusKey = focus ? `${focus.tableIds.join(',')}|${focus.date ?? ''}|${planFor ?? ''}` : null
  useEffect(() => {
    if (!focus || !plan || !focusKey || focusDone === focusKey) return
    setFocusDone(focusKey)
    const ids = focus.tableIds.filter((id) => plan.floors.some((f) => f.tables.some((t) => t.id === id)))
    if (ids.length === 0) return
    // Våningen med flest av bokningens bord (vid lika: den första).
    const home = [...plan.floors].sort(
      (x, y) => y.tables.filter((t) => ids.includes(t.id)).length - x.tables.filter((t) => ids.includes(t.id)).length,
    )[0]
    setFloorId(home.id)
    const d = focus.date
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && d <= lastBookableDate(today)) setDate(d)
    // Ett bord: det väljs (tider och formulär). Flera: alla markeras, inget väljs.
    setTableId(ids.length === 1 ? ids[0] : null)
    setStartTime('')
    setLinkedIds(ids)
    setFlashIds(ids)
    requestAnimationFrame(() => mapRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }))
  }, [focus, plan, focusKey, focusDone, today])
  useEffect(() => {
    if (flashIds.length === 0) return
    const timer = window.setTimeout(() => setFlashIds([]), 2600)
    return () => window.clearTimeout(timer)
  }, [flashIds])
  const size = Number(partySize)
  const sizeOk = /^\d+$/.test(partySize) && size >= 1 && size <= 50
  const staff = staffPhone(channel, phone, phoneTouched)
  const emailOk = !email.trim() || validEmail(email)
  const canNotify = Boolean(phone.trim() || email.trim())
  // En vald tid som inte längre är ledig (någon hann före) gäller inte.
  const timeGone = Boolean(table && startTime && !slotsLoading && !(freeTimes.get(table.id) ?? []).includes(startTime))
  const chosenTime = timeGone ? '' : startTime
  const valid = Boolean(table && chosenTime && sizeOk && name.trim() && staff.ok && emailOk)
  const times = table ? (freeTimes.get(table.id) ?? []) : []

  function chooseChannel(next: StaffChannel) {
    if (next === channel) return
    setChannel(next)
    setNotify(next === 'phone')
    setStartTime('')
    clearAttempt()
    if (next === 'walk_in') setDate(today)
  }

  /** Svaret på förra försöket gäller inte längre (annat bord, tid, datum, storlek eller kanal). */
  function clearAttempt() {
    setError(null)
    setPhoneError(null)
    setNoCard(false)
    setLastWaive(false)
  }

  function editPhone(value: string) {
    setPhone(value)
    setPhoneError(null)
    setNoCard(false)
    setLastWaive(false)
  }

  function pickTable(id: string) {
    setTableId(id)
    setLinkedIds([])
    setStartTime('')
    clearAttempt()
    setDone(null)
    // I telefonen ligger formuläret under kartan.
    requestAnimationFrame(() => {
      if (window.matchMedia?.('(max-width: 900px)').matches) {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  /** Ett bords läge i kartan (ledigt, för litet, fullbokat) och vad ett tryck gör. */
  function tableView(t: TableElement): TableView {
    const free = (freeTimes.get(t.id) ?? []).length
    const fits = !sizeOk || t.seats >= size
    const state = slotsLoading ? 'loading' : free === 0 ? 'full' : fits ? 'free' : 'small'
    const stateText =
      state === 'loading' ? 'hämtar tider' : state === 'full' ? 'fullbokat' : state === 'small' ? `${free} lediga tider, för litet` : `${free} lediga tider`
    const off = state === 'full' || state === 'loading'
    return {
      state,
      selected: t.id === tableId,
      extra: `${flashIds.includes(t.id) ? ' is-focus' : ''}${linkedIds.includes(t.id) ? ' is-linked' : ''}`,
      focusable: !off,
      disabled: off,
      name: `Bord ${label(t)}, ${t.seats} pl, ${stateText}`,
      onPick: () => {
        if (!off) pickTable(t.id)
      },
    }
  }

  async function book(waive = false) {
    if (!valid || busy || !table || !locationId) return
    setBusy(true)
    setError(null)
    setPhoneError(null)
    setLastWaive(waive)
    try {
      const created = await createManualReservation(locationId, {
        date,
        startTime: chosenTime,
        tableIds: [table.id],
        partySize: size,
        name: name.trim(),
        ...(staff.phone ? { phone: staff.phone } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        source: channel,
        notifyGuest: canNotify && notify,
        ...(channel === 'phone' ? { guarantee: waive ? ('waived' as const) : ('sms' as const) } : {}),
      })
      const who = `${created.customerName ?? name.trim()}, bord ${label(table)} kl ${created.startTime ?? chosenTime}`
      setDone(
        created.status === 'pending'
          ? `Kortlänk skickad: ${who}. Hålls till ${clockLabel(cardDeadline(created), created.timezone ?? location?.timezone)}.`
          : created.guaranteeSkipped === 'too_soon'
            ? `Bokad utan kort (för nära starttiden): ${who}.`
            : `Bokat: ${who}.`,
      )
      setTableId(null)
      setStartTime('')
      setName('')
      setPhone('')
      setPhoneTouched(false)
      setNoCard(false)
      setLastWaive(false)
      setEmail('')
      setNotes('')
      setTick((n) => n + 1)
    } catch (err) {
      const atPhone = phoneFieldError(err)
      // Gick Boka utan kort inte står valet kvar (Försök igen bokar också utan kort).
      setNoCard(channel === 'phone' && (waive || noCardOffer(err)))
      if (atPhone) {
        setPhoneError(atPhone)
        document.getElementById('fb-phone')?.focus()
      } else {
        setError(createErrorMessage(err))
        // Felrutan står sist i formuläret: visa den (i telefonen ligger den annars under knapparna).
        requestAnimationFrame(() => document.getElementById('fb-error')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
      }
      if (isStaleSlotError(err)) {
        setStartTime('')
        setTick((n) => n + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void book()
  }

  return (
    <>
      <AdminTopbar title="Layout" actions={actions} />
      <div className="admin-main floor-booking">
        {notice}
        {planState === 'loading' && <Loading label="Hämtar bordskartan" />}
        {planState === 'error' && (
          <ErrorNote text={planError} />
        )}
        {planState === 'none' && (
          <section className="admin-card table-card">
            <h2 className="card-title">Ingen bordskarta än</h2>
            <p className="cell-muted">Publicera en layout först.</p>
          </section>
        )}
        {planState === 'ready' && plan && floor && (
          <>
            <section className="admin-card floor-booking-controls" aria-label="Bokningens uppgifter">
              <ChannelPicker value={channel} onChange={chooseChannel} />
              <div className="floor-booking-fields">
                <div className="form-field">
                  <label htmlFor="fb-date">Datum</label>
                  <DateInput
                    id="fb-date"
                    value={date}
                    min={today}
                    max={lastBookableDate(today)}
                    disabled={walkIn}
                    onChange={(e) => {
                      if (!e.target.value) return
                      setDate(e.target.value)
                      setStartTime('')
                      clearAttempt()
                      setDone(null)
                    }}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="fb-size">Antal personer</label>
                  <input
                    id="fb-size"
                    inputMode="numeric"
                    value={partySize}
                    onChange={(e) => {
                      setPartySize(e.target.value)
                      clearAttempt()
                    }}
                    aria-invalid={!sizeOk || undefined}
                  />
                </div>
              </div>
              {walkIn && <p className="field-hint">Drop-in bokas alltid idag.</p>}
              {!slotsLoading && dayNotice(day) && (
                <p className="field-hint" role="note">
                  {dayNotice(day)}
                </p>
              )}
              {slotsError && (
                <ErrorNote text={slotsError} />
              )}
            </section>

            {done && (
              <p className="floor-booking-done" role="status">
                {done}
              </p>
            )}

            <div className="floor-booking-grid">
              <section className="admin-card floor-map-card" aria-label="Bordskarta" ref={mapRef}>
                {plan.floors.length > 1 && (
                  <FloorTabs floors={plan.floors} activeId={floor.id} onPick={setFloorId} markIds={linkedIds} />
                )}
                <div className="floor-map-legend" aria-hidden="true">
                  <span className="legend-free">Ledigt</span>
                  <span className="legend-small">För litet</span>
                  <span className="legend-full">Fullbokat</span>
                  {slotsLoading && <Loading variant="inline" label="Hämtar tider" />}
                </div>
                <FloorMap floor={floor} label={label} view={tableView} />
              </section>

              <section className="admin-card floor-booking-panel" ref={panelRef} aria-live="polite">
                {!table ? (
                  linked.length > 1 ? (
                    <div className="floor-booking-hint">
                      <h2 className="card-title">Bord {linked.map((t) => label(t)).join(' + ')}</h2>
                      <p className="cell-muted">Bokningens bord. Tryck på ett ledigt bord för att boka.</p>
                    </div>
                  ) : (
                    <p className="cell-muted floor-booking-hint">Tryck på ett ledigt bord.</p>
                  )
                ) : (
                  <form className="booking-form" onSubmit={submit}>
                    <div className="floor-booking-head">
                      <h2 className="card-title">Bord {label(table)}</h2>
                      <p className="cell-muted">
                        {table.seats} platser{table.zone ? ` · ${table.zone}` : ''}
                      </p>
                    </div>
                    {sizeOk && table.seats < size && (
                      <p className="field-hint error">
                        Bordet har {table.seats} platser, sällskapet är {size}.
                      </p>
                    )}
                    <fieldset className="table-picker">
                      <legend className="form-section-label">Lediga tider</legend>
                      {timeGone && (
                        <p className="form-error" role="status">
                          {startTime} är inte längre ledig vid bordet. Välj en ny tid.
                        </p>
                      )}
                      {times.length === 0 ? (
                        <p className="cell-muted">{slotsLoading ? 'Hämtar tider…' : 'Inga lediga tider vid bordet den dagen.'}</p>
                      ) : (
                        <div className="table-chips" role="radiogroup" aria-label="Tid">
                          {times.map((time) => (
                            <button
                              key={time}
                              type="button"
                              role="radio"
                              aria-checked={chosenTime === time}
                              className={`table-chip time-chip${chosenTime === time ? ' selected' : ''}`}
                              onClick={() => {
                                setStartTime(time)
                                clearAttempt()
                              }}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      )}
                    </fieldset>
                    <div className="form-field">
                      <label htmlFor="fb-name">Namn</label>
                      <input id="fb-name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
                    </div>
                    <div className="form-grid">
                      <StaffPhoneField
                        id="fb-phone"
                        label={channel === 'phone' ? <label htmlFor="fb-phone">Telefon</label> : <label htmlFor="fb-phone">Telefon (valfritt)</label>}
                        value={phone}
                        error={phoneError ?? staff.error}
                        onChange={editPhone}
                        onBlur={() => setPhoneTouched(true)}
                      />
                      <div className="form-field">
                        <label htmlFor="fb-email">E-post (valfritt)</label>
                        <input
                          id="fb-email"
                          type="email"
                          maxLength={EMAIL_MAX}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          aria-invalid={!emailOk || undefined}
                          aria-describedby={emailOk ? undefined : 'fb-email-error'}
                        />
                        {!emailOk && (
                          <p id="fb-email-error" className="field-hint error">
                            Ange en giltig e-postadress.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="fb-notes">Anteckning (valfritt)</label>
                      <textarea id="fb-notes" rows={2} maxLength={NOTES_MAX} value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                    {canNotify && <NotifyGuestCheck channel={channel} checked={notify} onChange={setNotify} />}
                    {error && (
                      <ErrorNote id="fb-error" text={error} onRetry={valid ? () => void book(lastWaive) : undefined} />
                    )}
                    <div className={`modal-actions${noCard ? ' has-no-card' : ''}`}>
                      <button
                        type="button"
                        className="btn outline square"
                        onClick={() => {
                          setTableId(null)
                          clearAttempt()
                        }}
                      >
                        Avbryt
                      </button>
                      {noCard && (
                        <button type="button" className="btn outline square no-card-btn" disabled={!valid || busy} onClick={() => void book(true)}>
                          Boka utan kort
                        </button>
                      )}
                      <button type="submit" className="btn primary square" disabled={!valid || busy}>
                        {busy ? 'Bokar…' : 'Boka bordet'}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </>
  )
}
