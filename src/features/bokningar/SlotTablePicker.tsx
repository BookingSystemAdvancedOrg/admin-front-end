import { useEffect, useState } from 'react'
import { errorMessage, getAvailability } from './bookingsApi'
import type { AvailabilitySlot } from './bookingsApi'

/**
 * Datum, tid och bord för en ny eller flyttad bokning, från platsens lediga
 * tider (GET /availability). `keep` = bokningens egna bord och tid när den
 * redigeras - de räknas som lediga för den själv (servern ignorerar
 * bokningens egna bord vid kontrollen).
 */
export function SlotTablePicker({
  locationId,
  date,
  startTime,
  tableIds,
  partySize,
  keep,
  walkIn = false,
  onChange,
}: {
  locationId: string
  date: string
  startTime: string
  tableIds: string[]
  partySize: number
  keep?: { date: string; startTime: string; tableIds: string[]; seats?: number }
  /** Drop-in: även pågående tider och de som börjar inom 30 minuter. */
  walkIn?: boolean
  onChange: (next: { date: string; startTime: string; tableIds: string[] }) => void
}) {
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getAvailability(locationId, date, { walkIn })
      .then((s) => {
        if (cancelled) return
        setSlots(s)
        setError(null)
        setLoadedFor(`${date}|${walkIn}`)
      })
      .catch((err) => {
        if (cancelled) return
        setSlots([])
        setError(errorMessage(err))
        setLoadedFor(`${date}|${walkIn}`)
      })
    return () => {
      cancelled = true
    }
  }, [locationId, date, walkIn])

  const loading = loadedFor !== `${date}|${walkIn}`
  const ownSlot = keep && keep.date === date ? keep : null
  const times = [...(slots ?? []).map((s) => s.startTime)]
  if (ownSlot && !times.includes(ownSlot.startTime)) times.push(ownSlot.startTime)
  times.sort()

  const slot = (slots ?? []).find((s) => s.startTime === startTime)
  const tables = [...(slot?.tables ?? [])]
  if (ownSlot && ownSlot.startTime === startTime) {
    for (const id of ownSlot.tableIds) {
      if (!tables.some((t) => t.tableId === id)) tables.push({ tableId: id, seats: 0 })
    }
  }
  tables.sort((a, b) => a.tableId.localeCompare(b.tableId, 'sv', { numeric: true }))
  const seats = tables
    .filter((t) => tableIds.includes(t.tableId))
    .reduce((sum, t) => sum + t.seats, 0)

  function toggle(id: string) {
    const next = tableIds.includes(id) ? tableIds.filter((t) => t !== id) : [...tableIds, id]
    onChange({ date, startTime, tableIds: next })
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
            onChange={(e) =>
              e.target.value && onChange({ date: e.target.value, startTime: '', tableIds: [] })
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor="slot-time">Tid</label>
          <select
            id="slot-time"
            value={startTime}
            disabled={loading || times.length === 0}
            onChange={(e) => {
              const same = ownSlot && ownSlot.startTime === e.target.value
              onChange({ date, startTime: e.target.value, tableIds: same ? ownSlot.tableIds : [] })
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {startTime && (
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
          {tableIds.length > 0 && seats > 0 && (
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
