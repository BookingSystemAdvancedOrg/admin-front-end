import { useEffect, useRef, useState } from 'react'
import { addDays, errorMessage, getAvailability } from './bookingsApi'
import type { AvailabilitySlot } from './bookingsApi'

/** Hur ofta listan med lediga tider hämtas om medan formuläret är öppet. */
export const SLOT_REFRESH_MS = 60_000
/** Längst fram man kan boka (servern: 21 dagar). */
const HORIZON_DAYS = 20

export interface SlotValue {
  date: string
  startTime: string
  tableIds: string[]
}

/**
 * Datum, tid och bord för en ny eller flyttad bokning, från platsens lediga
 * tider (GET /availability) - samma tider som servern godkänner: hel- och
 * halvtimmar, minst 30 minuter fram. `walkIn` (drop-in) tar även med
 * pågående tider och de inom 30 minuter, och låser datumet till idag.
 *
 * `keep` = bokningens egen tid och egna bord när den redigeras: de räknas
 * som lediga för den själv (servern ignorerar bokningens egna bord), även
 * om tiden är pågående eller från ett äldre schema.
 *
 * Listan hämtas om varje minut och när `refreshKey` ändras. Försvinner den
 * valda tiden (eller ett valt bord) tas valet bort med en förklaring, så att
 * ingen skickar en tid som inte går längre.
 */
export function SlotTablePicker({
  locationId,
  date,
  startTime,
  tableIds,
  partySize,
  today,
  keep,
  walkIn = false,
  refreshKey = 0,
  onChange,
}: {
  locationId: string
  date: string
  startTime: string
  tableIds: string[]
  partySize: number
  /** Dagens datum i platsens tidszon (YYYY-MM-DD). */
  today: string
  /** Bokningens egen tid och egna bord (och deras platser totalt). */
  keep?: { date: string; startTime: string; tableIds: string[]; seats?: number }
  walkIn?: boolean
  refreshKey?: number
  onChange: (next: SlotValue) => void
}) {
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const requestKey = `${locationId}|${date}|${walkIn}`

  // Den senaste valda tiden/borden - läses när en ny lista kommer, utan att
  // varje val startar en ny hämtning.
  const latest = useRef({ date, startTime, tableIds, keep, onChange })
  useEffect(() => {
    latest.current = { date, startTime, tableIds, keep, onChange }
  })

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), SLOT_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    getAvailability(locationId, date, { walkIn })
      .then((fresh) => {
        if (cancelled) return
        setSlots(fresh)
        setError(null)
        setLoadedFor(requestKey)
        const cur = latest.current
        if (cur.date !== date || !cur.startTime) return
        const own = cur.keep && cur.keep.date === date && cur.keep.startTime === cur.startTime
          ? cur.keep
          : null
        const slot = fresh.find((s) => s.startTime === cur.startTime)
        if (!slot && !own) {
          setNotice(`${cur.startTime} går inte att boka längre - välj en ny tid.`)
          cur.onChange({ date, startTime: '', tableIds: [] })
          return
        }
        const free = new Set([...(slot?.tables ?? []).map((t) => t.tableId), ...(own?.tableIds ?? [])])
        const still = cur.tableIds.filter((id) => free.has(id))
        if (still.length !== cur.tableIds.length) {
          setNotice('Ett valt bord har hunnit bokas - välj bord igen.')
          cur.onChange({ date, startTime: cur.startTime, tableIds: still })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setSlots([])
        setError(errorMessage(err))
        setLoadedFor(requestKey)
      })
    return () => {
      cancelled = true
    }
  }, [locationId, date, walkIn, requestKey, refreshKey, tick])

  const loading = loadedFor !== requestKey
  const ownSlot = keep && keep.date === date ? keep : null
  const times = (loading ? [] : (slots ?? [])).map((s) => s.startTime)
  if (ownSlot && !times.includes(ownSlot.startTime)) times.push(ownSlot.startTime)
  times.sort()

  const slot = loading ? undefined : (slots ?? []).find((s) => s.startTime === startTime)
  const tables = [...(slot?.tables ?? [])]
  if (ownSlot && ownSlot.startTime === startTime) {
    for (const id of ownSlot.tableIds) {
      if (!tables.some((t) => t.tableId === id)) tables.push({ tableId: id, seats: 0 })
    }
  }
  tables.sort((a, b) => a.tableId.localeCompare(b.tableId, 'sv', { numeric: true }))
  const chosen = tables.filter((t) => tableIds.includes(t.tableId))
  // Bokningens egna bord visas inte som lediga, så deras platser per bord är
  // okända här - bara summan för alla egna bord (keep.seats). Väljs en del
  // av dem avgör servern, och ingen siffra visas.
  const ownIds = ownSlot && ownSlot.startTime === startTime ? ownSlot.tableIds : []
  const ownChosen = chosen.filter((t) => ownIds.includes(t.tableId) && t.seats === 0)
  const otherSeats = chosen
    .filter((t) => !ownChosen.includes(t))
    .reduce((sum, t) => sum + t.seats, 0)
  const allOwnChosen = ownChosen.length > 0 && ownIds.every((id) => tableIds.includes(id))
  const seatsKnown =
    chosen.length > 0 &&
    (ownChosen.length === 0 || (allOwnChosen && typeof ownSlot?.seats === 'number'))
  const seats = otherSeats + (ownChosen.length > 0 ? (ownSlot?.seats ?? 0) : 0)

  function pick(next: SlotValue) {
    setNotice(null)
    onChange(next)
  }

  function toggle(id: string) {
    const next = tableIds.includes(id) ? tableIds.filter((t) => t !== id) : [...tableIds, id]
    pick({ date, startTime, tableIds: next })
  }

  return (
    <div className="slot-picker">
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="slot-date">Datum</label>
          <input
            id="slot-date"
            type="date"
            value={date}
            min={today}
            max={addDays(today, HORIZON_DAYS)}
            disabled={walkIn}
            onChange={(e) =>
              e.target.value && pick({ date: e.target.value, startTime: '', tableIds: [] })
            }
          />
          {walkIn && <p className="field-hint">Drop-in bokas alltid idag.</p>}
        </div>
        <div className="form-field">
          <label htmlFor="slot-time">Tid</label>
          <select
            id="slot-time"
            value={startTime}
            disabled={loading || times.length === 0}
            onChange={(e) => {
              const same = ownSlot && ownSlot.startTime === e.target.value
              pick({ date, startTime: e.target.value, tableIds: same ? ownSlot.tableIds : [] })
            }}
          >
            <option value="">
              {loading ? 'Hämtar tider…' : times.length === 0 ? 'Inga lediga tider' : 'Välj tid'}
            </option>
            {times.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      {notice && (
        <p className="form-error" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {startTime && !loading && (
        <fieldset className="table-picker">
          <legend className="form-section-label">Bord</legend>
          {tables.length === 0 && <p className="cell-muted">Inga lediga bord den tiden.</p>}
          <div className="table-chips">
            {tables.map((t) => (
              <label
                key={t.tableId}
                className={`table-chip${tableIds.includes(t.tableId) ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={tableIds.includes(t.tableId)}
                  onChange={() => toggle(t.tableId)}
                />
                Bord {t.tableId}
                {t.seats > 0 && <span className="cell-muted"> · {t.seats} pl</span>}
              </label>
            ))}
          </div>
          {seatsKnown && (
            <p className={seats < partySize ? 'form-error' : 'cell-muted'}>
              {seats < partySize
                ? `Valda bord har ${seats} platser - sällskapet är ${partySize}.`
                : `Valda bord har ${seats} platser.`}
            </p>
          )}
        </fieldset>
      )}
    </div>
  )
}
