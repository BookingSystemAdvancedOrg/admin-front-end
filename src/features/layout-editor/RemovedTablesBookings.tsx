import { useEffect, useState } from 'react'
import { listReservations } from '../bokningar/bookingsApi'
import { tableNames, useTables } from '../../shared/tables'
import type { RemovedTableBooking } from './layoutApi'

/** "fre 20 nov" ur ett lokalt datum (YYYY-MM-DD). */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\.$/, '')
}

/** Gästernas namn per bokning, ur dagarnas bokningslistor. Ett fel ger inga namn. */
function useGuestNames(locationId: string, bookings: RemovedTableBooking[]): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const key = bookings.map((b) => `${b.date}/${b.reservationId}`).join(',')
  useEffect(() => {
    let cancelled = false
    const dates = [...new Set(bookings.map((b) => b.date))]
    Promise.all(dates.map((date) => listReservations(locationId, date).catch(() => [])))
      .then((days) => {
        if (cancelled) return
        const found = new Map<string, string>()
        for (const r of days.flat()) {
          if (r.customerName) found.set(r.reservationId, r.customerName)
        }
        setNames(found)
      })
    return () => {
      cancelled = true
    }
    // key fångar listans innehåll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, key])
  return names
}

/**
 * Bokningarna som måste flyttas först: dag, tid, gäst och bord. Bordens
 * nummer är den gällande ritningens (bord som en ny version tar bort), eller
 * `labels` när borden bara finns i den väntande versionen.
 */
export function RemovedTablesBookings({
  locationId,
  bookings,
  labels: given,
}: {
  locationId: string
  bookings: RemovedTableBooking[]
  /** Bordens nummer i en annan ritning än den gällande. */
  labels?: Map<string, string>
}) {
  const current = useTables(given ? null : locationId)
  const labels = given ?? current.labels
  const names = useGuestNames(locationId, bookings)
  if (bookings.length === 0) return null
  return (
    <ul className="removed-bookings" aria-label="Bokningar att flytta">
      {bookings.map((b, i) => (
        <li key={`${b.reservationId}-${i}`}>
          <span className="removed-bookings-day">{dayLabel(b.date)}</span>
          <span className="removed-bookings-time">{b.startTime}</span>
          <span className="removed-bookings-guest">{names.get(b.reservationId) ?? 'Gäst'}</span>
          <span className="removed-bookings-table">{tableNames(b.tableIds, labels)}</span>
        </li>
      ))}
    </ul>
  )
}
