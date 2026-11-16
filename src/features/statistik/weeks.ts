import type { DayPoint, InsightsResponse } from './insights'
import { addDays, parseDay, weekdayOf } from './stats'

/** Gäster per vecka på Statistik (Overview): veckor måndag till söndag. */

export const WEEKS = 8

/** Veckonummer enligt ISO 8601 (svenska veckor). */
export function isoWeek(iso: string): number {
  const d = parseDay(iso)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

export interface WeekPoint {
  start: string
  week: number
  guests: number
  bookings: number
  noShows: number
  /** Gäster i bokningar som ligger kvar resten av veckan (bara denna vecka). */
  ahead: number
}

/** Dagarna och de kommande bokningarna per vecka, måndag till söndag. */
export function byWeek(days: DayPoint[], upcoming: InsightsResponse['upcoming'], today: string, weeks = WEEKS): WeekPoint[] {
  const monday = addDays(today, -weekdayOf(today))
  const out: WeekPoint[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(monday, -7 * i)
    out.push({ start, week: isoWeek(start), guests: 0, bookings: 0, noShows: 0, ahead: 0 })
  }
  const weekOf = (date: string) => out.find((w) => w.start <= date && date <= addDays(w.start, 6))
  for (const d of days) {
    const w = weekOf(d.date)
    if (!w) continue
    w.guests += d.guests
    w.bookings += d.bookings
    w.noShows += d.noShows
  }
  for (const u of upcoming ?? []) {
    const w = weekOf(u.date)
    if (!w) continue
    w.guests += u.guests
    w.bookings += u.bookings
    w.ahead += u.guests
  }
  return out
}
