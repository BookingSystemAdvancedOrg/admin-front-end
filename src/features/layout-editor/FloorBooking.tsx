import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
import { Loading } from '../../shared/Loading'
import { currentLocation, useTenant } from '../../shared/tenant'
import { tablesFromLayout } from '../../shared/tables'
import { ChannelPicker } from '../bokningar/ChannelPicker'
import type { StaffChannel } from '../bokningar/ChannelPicker'
import {
  EMAIL_MAX,
  NAME_MAX,
  addDays,
  NOTES_MAX,
  createManualReservation,
  dayNotice,
  errorMessage,
  LOCATION_NOT_BOOKABLE,
  getAvailability,
  isStaleSlotError,
  normalizePhone,
  todayIn,
  validEmail,
} from '../bokningar/bookingsApi'
import type { AvailabilitySlot, DayStatus } from '../bokningar/bookingsApi'
import { SLOT_REFRESH_MS } from '../bokningar/SlotTablePicker'
import { DateInput } from '../../shared/DateInput'
import { toFloors } from './layoutApi'
import type { LayoutElement } from './layoutApi'
import type { Floor, TableElement } from './data'
import '../bokningar/bokningar.css'
import './floor-booking.css'
import { ErrorNote } from '../../shared/ErrorNote'

/** Längst fram personalen kan boka (servern: 21 dagar). */
const HORIZON_DAYS = 20

interface PublicLayout {
  floors: { floorId: string; name?: string; level: number }[]
  elements: (Omit<LayoutElement, 'updatedBy' | 'updatedAt'> & { label?: string })[]
}

/** Den gällande planen (samma som gästerna bokar mot); null = ingen publicerad. */
async function loadActiveLayout(locationId: string): Promise<{ floors: Floor[]; labels: Map<string, string> } | null> {
  let layout: PublicLayout
  try {
    layout = await apiFetch<PublicLayout>(`/locations/${encodeURIComponent(locationId)}/layout/active`)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
  // Ingen aktiv layout än: servern svarar 200 med en tom plan.
  if (layout.floors.length === 0 && layout.elements.length === 0) return null
  const stamp = { updatedBy: '', updatedAt: '' }
  const elements: LayoutElement[] = [
    ...layout.floors.map((f) => ({
      elementId: f.floorId,
      type: 'floor' as const,
      name: f.name,
      level: f.level,
      x: 0,
      y: 0,
      z: 0,
      width: 0,
      height: 0,
      depth: 0,
      rotationY: 0,
      ...stamp,
    })),
    ...layout.elements.map((e) => ({ ...e, ...stamp })),
  ]
  const labels = new Map(tablesFromLayout(layout).map((t) => [t.tableId, t.label]))
  return { floors: toFloors(elements), labels }
}

/** Vy-rutan runt allt som är ritat på våningen, med lite luft. */
function bounds(floor: Floor): { x: number; y: number; w: number; h: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const g of floor.grounds) {
    xs.push(g.x, g.x + g.w)
    ys.push(g.y, g.y + g.h)
  }
  for (const w of floor.walls) {
    xs.push(w.x, w.dir === 'h' ? w.x + w.length : w.x)
    ys.push(w.y, w.dir === 'v' ? w.y + w.length : w.y)
  }
  for (const t of floor.tables) {
    const r = Math.max(t.w, t.h) * 0.7 + 12
    xs.push(t.x - r, t.x + r)
    ys.push(t.y - r, t.y + r)
  }
  if (xs.length === 0) return { x: -200, y: -150, w: 400, h: 300 }
  const pad = 30
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

/**
 * Boka direkt från bordskartan: personalen trycker på ett ledigt bord, ser
 * dess platser och lediga tider, väljer hur gästen bokade (telefon eller
 * drop-in) och fyller i gästen. Planen är den publicerade, gällande (samma
 * bord-id och "Bord 3" som gästerna ser). Bokningen går genom samma
 * POST /reservations som Bokningar, så servern prövar tiden och bordet
 * igen och nekar en dubbelbokning (409), varpå tiderna hämtas om.
 */
export function FloorBooking({ actions, notice }: { actions?: ReactNode; notice?: ReactNode }) {
  const tenantState = useTenant()
  const { locationId } = tenantState
  const location = currentLocation(tenantState)
  const today = todayIn(location?.timezone)
  const [plan, setPlan] = useState<{ floors: Floor[]; labels: Map<string, string> } | null>(null)
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
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [notify, setNotify] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

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
        setPlanError(errorMessage(err, 'Kunde inte hämta bordskartan.', LOCATION_NOT_BOOKABLE))
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
        setSlotsError(errorMessage(err, 'Kunde inte hämta lediga tider.', LOCATION_NOT_BOOKABLE))
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
  const size = Number(partySize)
  const sizeOk = /^\d+$/.test(partySize) && size >= 1 && size <= 50
  const normalizedPhone = phone.trim() ? normalizePhone(phone) : null
  const phoneOk = !phone.trim() || normalizedPhone !== null
  const emailOk = !email.trim() || validEmail(email)
  const canNotify = Boolean(phone.trim() || email.trim())
  // En vald tid som inte längre är ledig (någon hann före) gäller inte.
  const timeGone = Boolean(table && startTime && !slotsLoading && !(freeTimes.get(table.id) ?? []).includes(startTime))
  const chosenTime = timeGone ? '' : startTime
  const valid = Boolean(table && chosenTime && sizeOk && name.trim() && phoneOk && emailOk)
  const times = table ? (freeTimes.get(table.id) ?? []) : []

  function chooseChannel(next: StaffChannel) {
    if (next === channel) return
    setChannel(next)
    setNotify(next === 'phone')
    setStartTime('')
    setError(null)
    if (next === 'walk_in') setDate(today)
  }

  function pickTable(id: string) {
    setTableId(id)
    setStartTime('')
    setError(null)
    setDone(null)
    // I telefonen ligger formuläret under kartan.
    requestAnimationFrame(() => {
      if (window.matchMedia?.('(max-width: 900px)').matches) {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }

  /** Ett bords läge i kartan (ledigt, för litet, fullbokat) och vad ett tryck gör. */
  function tableState(t: { id: string; seats: number }) {
    const free = (freeTimes.get(t.id) ?? []).length
    const fits = !sizeOk || t.seats >= size
    const state = slotsLoading ? 'loading' : free === 0 ? 'full' : fits ? 'free' : 'small'
    const stateText =
      state === 'loading' ? 'hämtar tider' : state === 'full' ? 'fullbokat' : state === 'small' ? `${free} lediga tider, för litet` : `${free} lediga tider`
    const pick = () => {
      if (state !== 'full' && state !== 'loading') pickTable(t.id)
    }
    return { state, stateText, pick }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy || !table || !locationId) return
    setBusy(true)
    setError(null)
    try {
      const created = await createManualReservation(locationId, {
        date,
        startTime: chosenTime,
        tableIds: [table.id],
        partySize: size,
        name: name.trim(),
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        source: channel,
        notifyGuest: canNotify && notify,
      })
      setDone(`Bokat: ${created.customerName ?? name.trim()}, bord ${label(table)} kl ${created.startTime ?? chosenTime}.`)
      setTableId(null)
      setStartTime('')
      setName('')
      setPhone('')
      setEmail('')
      setNotes('')
      setTick((n) => n + 1)
    } catch (err) {
      setError(errorMessage(err, undefined, LOCATION_NOT_BOOKABLE))
      if (isStaleSlotError(err)) {
        setStartTime('')
        setTick((n) => n + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  const view = floor ? bounds(floor) : null

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
        {planState === 'ready' && plan && floor && view && (
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
                    max={addDays(today, HORIZON_DAYS)}
                    disabled={walkIn}
                    onChange={(e) => {
                      if (!e.target.value) return
                      setDate(e.target.value)
                      setStartTime('')
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
                    onChange={(e) => setPartySize(e.target.value)}
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
              <section className="admin-card floor-map-card" aria-label="Bordskarta">
                {plan.floors.length > 1 && (
                  <div className="floor-tabs" role="tablist" aria-label="Våning">
                    {plan.floors.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="tab"
                        aria-selected={f.id === floor.id}
                        className={f.id === floor.id ? 'active' : ''}
                        onClick={() => setFloorId(f.id)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
                <div className="floor-map-legend" aria-hidden="true">
                  <span className="legend-free">Ledigt</span>
                  <span className="legend-small">För litet</span>
                  <span className="legend-full">Fullbokat</span>
                  {slotsLoading && <Loading variant="inline" label="Hämtar tider" />}
                </div>
                <svg
                  className="floor-map"
                  viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                  preserveAspectRatio="xMidYMid meet"
                  role="group"
                  aria-label={`Bord på ${floor.name}`}
                >
                  {floor.grounds.map((g) => (
                    <rect key={g.id} className="floor-map-ground" x={g.x} y={g.y} width={g.w} height={g.h} />
                  ))}
                  {floor.walls.map((w) => (
                    <line
                      key={w.id}
                      className="floor-map-wall"
                      x1={w.x}
                      y1={w.y}
                      x2={w.dir === 'h' ? w.x + w.length : w.x}
                      y2={w.dir === 'v' ? w.y + w.length : w.y}
                    />
                  ))}
                  {/* Träffytorna runt borden ligger under alla bord: en grannes
                      träffyta täcker aldrig ett bord (man träffar det man trycker på). */}
                  {floor.tables.map((t) => {
                    const { pick } = tableState(t)
                    return (
                      <circle
                        key={`hit-${t.id}`}
                        className="floor-map-hit"
                        cx={t.x}
                        cy={t.y}
                        r={Math.max(t.w, t.h) / 2 + 18}
                        aria-hidden="true"
                        onClick={pick}
                      />
                    )
                  })}
                  {floor.tables.map((t) => {
                    const { state, stateText, pick } = tableState(t)
                    return (
                      <g
                        key={t.id}
                        className={`floor-map-table is-${state}${t.id === tableId ? ' is-selected' : ''}`}
                        transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}
                        role="button"
                        tabIndex={state === 'full' || state === 'loading' ? -1 : 0}
                        aria-disabled={state === 'full' || state === 'loading' || undefined}
                        aria-pressed={t.id === tableId}
                        aria-label={`Bord ${label(t)}, ${t.seats} pl (platser), ${stateText}`}
                        onClick={pick}
                        onKeyDown={(e: ReactKeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            pick()
                          }
                        }}
                      >
                        <g className="floor-map-body">
                          {t.shape === 'round' ? (
                            <circle className="floor-map-top" r={Math.max(t.w, t.h) / 2} />
                          ) : (
                            <rect className="floor-map-top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={6} />
                          )}
                          <g transform={`rotate(${-t.rotation})`}>
                            <text className="floor-map-label" y={-4}>
                              {label(t)}
                            </text>
                            <text className="floor-map-seats" y={14}>
                              {t.seats} pl
                            </text>
                          </g>
                        </g>
                      </g>
                    )
                  })}
                </svg>
              </section>

              <section className="admin-card floor-booking-panel" ref={panelRef} aria-live="polite">
                {!table ? (
                  <p className="cell-muted floor-booking-hint">Tryck på ett ledigt bord.</p>
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
                                setError(null)
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
                      <div className="form-field">
                        <label htmlFor="fb-phone">Telefon (valfritt)</label>
                        <input
                          id="fb-phone"
                          inputMode="tel"
                          placeholder="070-123 45 67"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          aria-invalid={!phoneOk || undefined}
                          aria-describedby={phoneOk ? undefined : 'fb-phone-error'}
                        />
                        {!phoneOk && (
                          <p id="fb-phone-error" className="field-hint error">
                            Skriv ett giltigt nummer, t.ex. 070-123 45 67.
                          </p>
                        )}
                      </div>
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
                    {canNotify && (
                      <label className="check-row">
                        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                        Skicka bekräftelse till gästen
                      </label>
                    )}
                    {error && (
                      <ErrorNote text={error} />
                    )}
                    <div className="modal-actions">
                      <button type="button" className="btn outline square" onClick={() => setTableId(null)}>
                        Avbryt
                      </button>
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
