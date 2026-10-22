/**
 * Schemalagda rätter: API:t lagrar availableFrom/availableUntil i UTC
 * ("...Z"), adminen visar och tar emot tider i platsens tidszon via
 * <input type="datetime-local"> ("YYYY-MM-DDTHH:mm"). Samma regel som
 * backenden (application shared/menu.py): rätten syns när den är aktiv och
 * från <= nu < till - till-tiden är inte med.
 */

function wallClockMs(instantMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .map((p) => [p.type, Number(p.value)]),
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

/**
 * "2026-03-29T02:30" i tidszonen -> "2026-03-29T...Z". null när tiden inte
 * finns (vårens hopp framåt); dubbeltimmen på hösten ger den tidigare.
 */
export function zonedInputToUtc(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  const day = 86_400_000
  // Förskjutningen före och efter en eventuell omställning täcker båda fallen.
  const candidates = [wall - day, wall + day]
    .map((t) => wall - (wallClockMs(t, timeZone) - t))
    .filter((t) => wallClockMs(t, timeZone) === wall)
  if (candidates.length === 0) return null
  return new Date(Math.min(...candidates)).toISOString().replace('.000Z', 'Z')
}

/** "...Z" -> "YYYY-MM-DDTHH:mm" i tidszonen, för datetime-local. */
export function utcToZonedInput(iso: string | null, timeZone: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(wallClockMs(t, timeZone)).toISOString().slice(0, 16)
}

/** "1 nov 10:00" i tidszonen. */
export function scheduleLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso))
}

export type DishStatus = 'active' | 'scheduled' | 'expired' | 'off'

export interface Schedulable {
  active: boolean
  availableFrom: string | null
  availableUntil: string | null
}

/** Vad gästen ser just nu. Av-växeln vinner alltid. */
export function dishStatus(dish: Schedulable, now: Date): DishStatus {
  if (!dish.active) return 'off'
  if (dish.availableFrom && now.getTime() < Date.parse(dish.availableFrom)) return 'scheduled'
  if (dish.availableUntil && now.getTime() >= Date.parse(dish.availableUntil)) return 'expired'
  return 'active'
}

export function dishStatusLabel(dish: Schedulable, now: Date, timeZone: string): string {
  switch (dishStatus(dish, now)) {
    case 'off':
      return 'Av'
    case 'scheduled':
      return `Schemalagd (startar ${scheduleLabel(dish.availableFrom!, timeZone)})`
    case 'expired':
      return `Utgången (slutade ${scheduleLabel(dish.availableUntil!, timeZone)})`
    default:
      return 'Aktiv'
  }
}

export type StatusFilter = 'alla' | 'active' | 'scheduled' | 'expired' | 'inactive'

/** Status-filtret: "Aktiva" = syns för gäster nu, "Inaktiva" = avstängda.
 * Utan schema blir det samma resultat som det gamla aktiv/inaktiv-filtret. */
export function matchesStatus(filter: StatusFilter, status: DishStatus): boolean {
  if (filter === 'alla') return true
  if (filter === 'inactive') return status === 'off'
  return status === filter
}
