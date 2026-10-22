import { WEEKDAYS } from './locationApi'
import type { Weekday } from './locationApi'

/**
 * Bokningstid (backend shared/booking_rules.py, bookingTimeRules): hur länge
 * en bokning varar beroende på starttiden, om personalen får förlänga och
 * sista sittning. Servern kontrollerar allt igen; här fångas felen innan
 * man sparar, på svenska.
 */

export interface BookingExtension {
  allowed: boolean
  /** 0 när förlängning inte är tillåten. */
  maxMinutes: number
}

export interface BookingTimeWindow {
  id: string
  name: string
  weekdays: Weekday[]
  startTime: string
  endTime: string
  dateFrom?: string
  dateTo?: string
  durationMinutes: number
  extension: BookingExtension
  priority: number
}

export interface BookingTimeRules {
  defaultMinutes: number
  extension: BookingExtension
  lastSeatingMinutes: number
  windows: BookingTimeWindow[]
}

export const STEP = 15
export const MAX_WINDOWS = 20
export const NAME_MAX = 40
export const DEFAULT_LAST_SEATING = 120

/** Längder att välja: kvartssteg till 4 timmar, sedan hela timmar till 8. */
export const DURATION_OPTIONS = [
  ...Array.from({ length: 16 }, (_, i) => (i + 1) * STEP),
  300, 360, 420, 480,
]
export const EXTENSION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240]
export const LAST_SEATING_OPTIONS = [0, 30, 60, 90, 120, 150, 180]

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  monday: 'Mån',
  tuesday: 'Tis',
  wednesday: 'Ons',
  thursday: 'Tor',
  friday: 'Fre',
  saturday: 'Lör',
  sunday: 'Sön',
}

/** "45 min", "1 tim", "1 tim 30 min". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return rest ? `${Math.floor(minutes / 60)} tim ${rest} min` : `${minutes / 60} tim`
}

const minute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))

/**
 * Platsens regler, eller utgångsläget för en äldre plats utan regler: dess
 * bokningslängd, ingen förlängning (precis som servern behandlar den tills
 * restaurangen sparar nya regler).
 */
export function rulesFromLocation(
  rules: BookingTimeRules | undefined,
  bookingDurationHours: number,
): BookingTimeRules {
  if (rules) {
    return {
      ...rules,
      lastSeatingMinutes: rules.lastSeatingMinutes ?? DEFAULT_LAST_SEATING,
      windows: rules.windows ?? [],
    }
  }
  return {
    defaultMinutes: Math.round(bookingDurationHours * 60),
    extension: { allowed: false, maxMinutes: 0 },
    lastSeatingMinutes: DEFAULT_LAST_SEATING,
    windows: [],
  }
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? `w${Date.now().toString(36)}`
}

export function newWindow(): BookingTimeWindow {
  return {
    id: newId(),
    name: 'Lunchbuffé',
    weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    startTime: '11:00',
    endTime: '14:00',
    durationMinutes: 60,
    extension: { allowed: false, maxMinutes: 0 },
    priority: 0,
  }
}

const dated = (w: BookingTimeWindow) => Boolean(w.dateFrom || w.dateTo)

/** Kan en och samma starttid hamna i båda fönstren? */
export function windowsOverlap(a: BookingTimeWindow, b: BookingTimeWindow): boolean {
  return (
    a.weekdays.some((d) => b.weekdays.includes(d)) &&
    a.startTime < b.endTime &&
    b.startTime < a.endTime &&
    (a.dateFrom || '0000-01-01') <= (b.dateTo || '9999-12-31') &&
    (b.dateFrom || '0000-01-01') <= (a.dateTo || '9999-12-31')
  )
}

/** Vilket av två överlappande fönster som gäller (som servern väljer). */
function winner(a: BookingTimeWindow, b: BookingTimeWindow): BookingTimeWindow | null {
  if (dated(a) !== dated(b)) return dated(a) ? a : b
  if (a.priority !== b.priority) return a.priority > b.priority ? a : b
  return null
}

/** Överlapp som går att lösa - visas som varning, inte fel. */
export function overlapWarnings(rules: BookingTimeRules): string[] {
  const out: string[] = []
  rules.windows.forEach((a, i) => {
    for (const b of rules.windows.slice(i + 1)) {
      if (!windowsOverlap(a, b)) continue
      const win = winner(a, b)
      if (!win) continue
      const reason = dated(a) !== dated(b) ? 'har datum' : 'högre prioritet'
      out.push(`${a.name} och ${b.name} överlappar - ${win.name} gäller där (${reason}).`)
    }
  })
  return out
}

function extensionError(ext: BookingExtension, label: string): string | null {
  if (!ext.allowed) return null
  if (!Number.isInteger(ext.maxMinutes) || ext.maxMinutes < STEP || ext.maxMinutes > 240 || ext.maxMinutes % STEP) {
    return `${label}: förlängning måste vara 15-240 minuter i kvartssteg.`
  }
  return null
}

const durationOk = (m: number) => Number.isInteger(m) && m >= STEP && m <= 480 && m % STEP === 0

/** Första felet (svenska), eller null. graceMinutes = platsens grace period. */
export function validateRules(rules: BookingTimeRules, graceMinutes: number): string | null {
  if (!durationOk(rules.defaultMinutes)) return 'Standardlängden måste vara 15 min - 8 tim i kvartssteg.'
  const ext = extensionError(rules.extension, 'Standard')
  if (ext) return ext
  if (rules.windows.length > MAX_WINDOWS) return `Högst ${MAX_WINDOWS} specialtider.`
  for (const w of rules.windows) {
    const label = w.name.trim() || 'Specialtid'
    if (!w.name.trim()) return 'Varje specialtid behöver ett namn.'
    if (w.name.trim().length > NAME_MAX) return `${label}: namnet får vara högst ${NAME_MAX} tecken.`
    if (w.weekdays.length === 0) return `${label}: välj minst en veckodag.`
    if (!/^\d\d:\d\d$/.test(w.startTime) || !/^\d\d:\d\d$/.test(w.endTime)) return `${label}: ange tider som TT:MM.`
    if (minute(w.startTime) % STEP || minute(w.endTime) % STEP) return `${label}: tiderna måste vara i kvartssteg.`
    if (w.startTime >= w.endTime) return `${label}: starttiden måste vara före sluttiden (inte över midnatt).`
    if (w.dateFrom && w.dateTo && w.dateFrom > w.dateTo) return `${label}: från-datumet måste vara före till-datumet.`
    if (!durationOk(w.durationMinutes)) return `${label}: längden måste vara 15 min - 8 tim i kvartssteg.`
    const wExt = extensionError(w.extension, label)
    if (wExt) return wExt
    if (!Number.isInteger(w.priority) || w.priority < 0 || w.priority > 100) {
      return `${label}: prioriteten måste vara ett heltal 0-100.`
    }
  }
  for (let i = 0; i < rules.windows.length; i++) {
    for (const b of rules.windows.slice(i + 1)) {
      const a = rules.windows[i]
      if (windowsOverlap(a, b) && !winner(a, b)) {
        return `${a.name} och ${b.name} överlappar med samma prioritet - ge den som ska gälla högre prioritet.`
      }
    }
  }
  const shortest = Math.min(rules.defaultMinutes, ...rules.windows.map((w) => w.durationMinutes))
  if (graceMinutes >= shortest) {
    return `Grace period (${graceMinutes} min) måste vara kortare än den kortaste bokningen (${minutesLabel(shortest)}).`
  }
  return null
}

/** Det som skickas till API:t (namn trimmade, tomma datum bort, veckodagar i ordning). */
export function toPayload(rules: BookingTimeRules): BookingTimeRules {
  return {
    defaultMinutes: rules.defaultMinutes,
    extension: rules.extension.allowed ? rules.extension : { allowed: false, maxMinutes: 0 },
    lastSeatingMinutes: rules.lastSeatingMinutes,
    windows: rules.windows.map((w) => {
      const out: BookingTimeWindow = {
        ...w,
        name: w.name.trim().replace(/\s+/g, ' '),
        weekdays: WEEKDAYS.filter((d) => w.weekdays.includes(d)),
        extension: w.extension.allowed ? w.extension : { allowed: false, maxMinutes: 0 },
      }
      if (!w.dateFrom) delete out.dateFrom
      if (!w.dateTo) delete out.dateTo
      return out
    }),
  }
}

/** Kort sammanfattning av ett fönster för listan. */
export function describeWindow(w: BookingTimeWindow): string {
  const days =
    w.weekdays.length === 7 ? 'alla dagar' : WEEKDAYS.filter((d) => w.weekdays.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(', ')
  const dates = w.dateFrom || w.dateTo
    ? ` · ${w.dateFrom ? `från ${w.dateFrom}` : ''}${w.dateFrom && w.dateTo ? ' ' : ''}${w.dateTo ? `till ${w.dateTo}` : ''}`
    : ''
  const ext = w.extension.allowed ? `kan förlängas ${minutesLabel(w.extension.maxMinutes)}` : 'kan inte förlängas'
  return `${days} ${w.startTime}-${w.endTime}${dates} · ${minutesLabel(w.durationMinutes)}, ${ext}`
}
