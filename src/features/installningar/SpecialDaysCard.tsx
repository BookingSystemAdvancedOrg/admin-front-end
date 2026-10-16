import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import { currentLocation, useTenant } from '../../shared/tenant'
import { ACTIVE_STATUSES, addDays, dayLabel, listReservations, todayIn } from '../bokningar/bookingsApi'
import { getLocation, updateLocation } from './locationApi'
import type { BusinessHoursInterval, SpecialDay, SpecialDayKind } from './locationApi'
import {
  BOOKING_HORIZON_DAYS,
  DAYS_AHEAD,
  KIND_LABEL,
  NOTE_MAX,
  describe,
  emptyDraft,
  intervalsError,
  sortDays,
} from './bookingRules'
import type { Draft } from './bookingRules'

/**
 * Avvikande öppettider för den valda platsen (backend shared/booking_rules.py):
 *
 *   Stängt               inga bokningar alls
 *   Andra öppettider     ersätter veckodagens tider (för alla)
 *   Ingen onlinebokning  vanliga tider, men bara personalen kan boka
 *
 * En kort anteckning visas för gästerna på bokningssidan ("Julafton").
 * Bokningar som redan finns en dag som stängs avbokas inte automatiskt -
 * kortet visar hur många det är, och personalen avbokar dem under
 * Bokningar (gästen får då ett meddelande). Passerade dagar tas bort när
 * listan sparas.
 */

/** Antal aktiva bokningar per datum (bara datum inom bokningshorisonten). */
function useBookingCounts(locationId: string | null, dates: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const key = dates.join(',')
  useEffect(() => {
    if (!locationId || !key) return
    let cancelled = false
    for (const date of key.split(',')) {
      listReservations(locationId, date).then(
        (items) => {
          if (cancelled) return
          const active = items.filter((r) => ACTIVE_STATUSES.includes(r.status)).length
          setCounts((prev) => ({ ...prev, [date]: active }))
        },
        () => {},
      )
    }
    return () => {
      cancelled = true
    }
  }, [locationId, key])
  return counts
}

export function SpecialDaysCard({
  locationId,
  isOwner,
}: {
  locationId: string | null
  isOwner: boolean
}) {
  const tenantState = useTenant()
  const today = todayIn(currentLocation(tenantState)?.timezone)
  const [saved, setSaved] = useState<SpecialDay[] | null>(null)
  const [days, setDays] = useState<SpecialDay[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved(loc.specialDays ?? [])
        setDays(loc.specialDays ?? [])
      })
      .catch(() => !cancelled && setError('Kunde inte hämta platsens avvikande dagar.'))
    return () => {
      cancelled = true
    }
  }, [locationId])

  const upcoming = days.filter((d) => d.date >= today)
  const horizon = addDays(today, BOOKING_HORIZON_DAYS)
  const counts = useBookingCounts(
    locationId,
    upcoming.filter((d) => d.kind !== 'no_online' && d.date <= horizon).map((d) => d.date),
  )
  const ready = saved !== null
  const disabled = !isOwner || busy || !ready
  const dirty = ready && JSON.stringify(sortDays(upcoming)) !== JSON.stringify(sortDays(saved.filter((d) => d.date >= today)))
  // En dag har en typ: har idag redan avvikande tider erbjuds inte snabbknappen
  // (den skulle ersätta tiderna).
  const todayIsSpecial = upcoming.some((d) => d.date === today)

  function change(next: SpecialDay[]) {
    setDays(sortDays(next))
    setNotice(null)
    setError(null)
  }

  function add() {
    setError(null)
    if (!draft.date) return setError('Välj ett datum.')
    if (draft.date < today) return setError('Datumet har redan passerat.')
    if (draft.date > addDays(today, DAYS_AHEAD)) return setError('Högst två år fram.')
    if (days.some((d) => d.date === draft.date)) {
      return setError('Det datumet finns redan i listan - ta bort det först.')
    }
    const note = draft.note.trim().replace(/\s+/g, ' ')
    if (note.length > NOTE_MAX) return setError(`Anteckningen får vara högst ${NOTE_MAX} tecken.`)
    const day: SpecialDay = { date: draft.date, kind: draft.kind }
    if (draft.kind === 'hours') {
      const problem = intervalsError(draft.intervals)
      if (problem) return setError(problem)
      day.intervals = [...draft.intervals].sort((a, b) => a.opensAt.localeCompare(b.opensAt))
    }
    if (note) day.note = note
    change([...days, day])
    setDraft(emptyDraft())
  }

  function closeOnlineToday() {
    change([...days.filter((d) => d.date !== today), { date: today, kind: 'no_online' }])
  }

  function setInterval_(index: number, patch: Partial<BusinessHoursInterval>) {
    setDraft((d) => ({
      ...d,
      intervals: d.intervals.map((iv, i) => (i === index ? { ...iv, ...patch } : iv)),
    }))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const updated = await updateLocation(locationId, {
        specialDays: upcoming.length ? sortDays(upcoming) : null,
      })
      setSaved(updated.specialDays ?? [])
      setDays(updated.specialDays ?? [])
      setNotice('Sparat. Bokningssidan visar det inom några minuter.')
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Bara restaurangens ägare kan ändra öppettiderna.'
          : err instanceof ApiError && err.status === 400
            ? `Kunde inte spara: ${err.message}`
            : 'Kunde inte spara just nu. Försök igen om en stund.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="avvikande-dagar" className="admin-card table-card">
      <h2 className="card-title">Avvikande öppettider</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">
        Stängda dagar, andra öppettider eller dagar utan onlinebokning. Gästerna ser det på
        bokningssidan; bokningar som redan finns avbokas inte automatiskt.
      </p>
      <div style={{ height: 16 }} />
      {!locationId ? (
        <p className="cell-muted">Välj en plats först.</p>
      ) : !ready ? (
        error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="cell-muted">Hämtar…</p>
        )
      ) : (
        <form onSubmit={save} className="notifications-form">
          {isOwner && !todayIsSpecial && (
            <button type="button" className="btn outline square" disabled={disabled} onClick={closeOnlineToday}>
              Stäng onlinebokning idag
            </button>
          )}
          {upcoming.length === 0 ? (
            <p className="cell-muted">Inga avvikande dagar.</p>
          ) : (
            <ul className="special-days">
              {upcoming.map((d) => {
                const count = counts[d.date] ?? 0
                return (
                  <li key={d.date}>
                    <div className="special-day-row">
                      <span>
                        <span className="cell-strong">{d.date === today ? 'Idag' : dayLabel(d.date)}</span>
                        <span className="cell-muted">
                          {' '}
                          · {describe(d)}
                          {d.note ? ` · ”${d.note}”` : ''}
                        </span>
                      </span>
                      {isOwner && (
                        <button
                          type="button"
                          className="link-btn"
                          disabled={disabled}
                          aria-label={`Ta bort ${dayLabel(d.date)}`}
                          onClick={() => change(days.filter((x) => x.date !== d.date))}
                        >
                          Ta bort
                        </button>
                      )}
                    </div>
                    {count > 0 && (
                      <p className="form-error">
                        {count} {count === 1 ? 'bokning finns' : 'bokningar finns'} den dagen -{' '}
                        {d.kind === 'closed'
                          ? 'de avbokas inte automatiskt. Avboka dem under Bokningar (gästen får ett meddelande).'
                          : 'kontrollera att de ryms inom de nya tiderna.'}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {isOwner && (
            <fieldset className="special-day-add" disabled={disabled}>
              <legend className="form-section-label">Lägg till dag</legend>
              <div className="form-grid">
                <div className="form-field">
                  <label htmlFor="special-date">Datum</label>
                  <input
                    id="special-date"
                    type="date"
                    min={today}
                    max={addDays(today, DAYS_AHEAD)}
                    value={draft.date}
                    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="special-kind">Typ</label>
                  <select
                    id="special-kind"
                    value={draft.kind}
                    onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as SpecialDayKind }))}
                  >
                    {(Object.keys(KIND_LABEL) as SpecialDayKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {draft.kind === 'hours' && (
                <div className="special-intervals">
                  {draft.intervals.map((iv, i) => (
                    <div key={i} className="special-interval">
                      <input
                        type="time"
                        aria-label={`Öppnar (tid ${i + 1})`}
                        value={iv.opensAt}
                        onChange={(e) => setInterval_(i, { opensAt: e.target.value })}
                      />
                      <span>–</span>
                      <input
                        type="time"
                        aria-label={`Stänger (tid ${i + 1})`}
                        value={iv.closesAt}
                        onChange={(e) => setInterval_(i, { closesAt: e.target.value })}
                      />
                      {draft.intervals.length > 1 && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() =>
                            setDraft((d) => ({ ...d, intervals: d.intervals.filter((_, j) => j !== i) }))
                          }
                        >
                          Ta bort tid
                        </button>
                      )}
                    </div>
                  ))}
                  {draft.intervals.length < 3 && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          intervals: [...d.intervals, { opensAt: '11:00', closesAt: '14:00' }],
                        }))
                      }
                    >
                      + Lägg till tid
                    </button>
                  )}
                </div>
              )}
              <div className="form-field">
                <label htmlFor="special-note">Anteckning till gästerna (valfritt)</label>
                <input
                  id="special-note"
                  maxLength={NOTE_MAX}
                  placeholder="t.ex. Julafton"
                  value={draft.note}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>
              <button type="button" className="btn outline square" onClick={add}>
                Lägg till
              </button>
            </fieldset>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {isOwner && (
            <span className="row-actions">
              <button type="submit" className="btn primary square" disabled={disabled}>
                {busy ? 'Sparar…' : 'Spara dagar'}
              </button>
              {notice && !dirty && (
                <span className="save-notice" role="status">
                  {notice}
                </span>
              )}
              {dirty && !busy && (
                <span className="form-error" role="status">
                  Ej sparat - klicka Spara dagar.
                </span>
              )}
            </span>
          )}
          {!isOwner && <p className="cell-muted">Bara restaurangens ägare kan ändra öppettiderna.</p>}
        </form>
      )}
    </section>
  )
}
