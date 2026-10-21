import type { Reservation, ReservationStatus } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { CateringStatus, RequestSummary } from '../catering/cateringApi'

/**
 * Ren logik för Statistik-sidan, utan React, så den går att testa direkt.
 * Allt räknas ur det API:t redan ger per dag (bokningar och betalda
 * beställningar) plus cateringförfrågningarna; inget sparas.
 * Belopp är i öre, som i resten av appen.
 */

/* --- Perioder ----------------------------------------------------------- */

export type PresetId = 'd7' | 'd14' | 'd30' | 'month' | 'lastMonth'

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'd7', label: '7 dagar' },
  { id: 'd14', label: '14 dagar' },
  { id: 'd30', label: '30 dagar' },
  { id: 'month', label: 'Den här månaden' },
  { id: 'lastMonth', label: 'Förra månaden' },
]

/** Längsta period som hämtas (varje dag är två anrop, två perioder jämförs). */
export const MAX_DAYS = 31

const pad = (n: number) => String(n).padStart(2, '0')

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1
}

/** Alla dagar från och med `from` till och med `to`. */
export function datesIn(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Perioden för ett val, räknad från dagens datum (YYYY-MM-DD) på platsen. */
export function presetRange(preset: PresetId, today: string): { from: string; to: string } {
  const t = parseDay(today)
  switch (preset) {
    case 'd7':
      return { from: addDays(today, -6), to: today }
    case 'd14':
      return { from: addDays(today, -13), to: today }
    case 'd30':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: today }
    case 'lastMonth': {
      const first = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const last = new Date(t.getFullYear(), t.getMonth(), 0)
      return { from: isoDay(first), to: isoDay(last) }
    }
  }
}

/** Lika lång period direkt före. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const n = daysBetween(from, to)
  return { from: addDays(from, -n), to: addDays(from, -1) }
}

/* --- Klassning ----------------------------------------------------------- */

export interface DayData {
  date: string
  reservations: Reservation[]
  orders: Order[]
}

const CANCELLED: ReadonlySet<ReservationStatus> = new Set([
  'cancelled_no_charge',
  'cancelled_by_restaurant',
  'cancelled_charged',
  'cancelled_charge_failed',
  'expired',
])
const NO_SHOW: ReadonlySet<ReservationStatus> = new Set(['no_show', 'no_show_charged', 'no_show_charge_failed'])

export function isCancelledStatus(s: ReservationStatus): boolean {
  return CANCELLED.has(s)
}

export function isNoShowStatus(s: ReservationStatus): boolean {
  return NO_SHOW.has(s)
}

/** Betald och inte avbruten: det som räknas som omsättning. */
export function isPaidOrder(o: Order): boolean {
  return o.paymentStatus === 'paid' && o.status !== 'cancelled' && o.status !== 'failed' && o.status !== 'pending_payment'
}

const CATERING_WON: ReadonlySet<CateringStatus> = new Set(['signed', 'confirmed', 'delivered', 'closed'])

/* --- Sammanställningen --------------------------------------------------- */

export interface DayPoint {
  date: string
  revenue: number
  orders: number
  bookings: number
  guests: number
}

export interface Dish {
  name: string
  quantity: number
  revenue: number
}

export interface Summary {
  from: string
  to: string
  days: number
  /** Öre: betalda beställningar plus catering levererad i perioden. */
  revenue: number
  orderRevenue: number
  cateringRevenue: number
  pickupRevenue: number
  tableRevenue: number
  orders: number
  /** Öre per betald beställning; null utan beställningar. */
  avgOrder: number | null
  /** Bokningar som inte avbokats (bokade, anlända, uteblivna). */
  bookings: number
  guests: number
  avgParty: number | null
  completed: number
  noShows: number
  cancelled: number
  /** Andel uteblivna av bokningarna som inte avbokats (procent). */
  noShowPct: number | null
  /** Andel avbokade av alla bokningar som gjordes (procent). */
  cancelledPct: number | null
  cardOnFilePct: number | null
  source: { online: number; phone: number; onsite: number }
  cateringRequests: number
  cateringWon: number
  byDay: DayPoint[]
  byHour: { hour: number; bookings: number }[]
  byWeekday: { weekday: number; label: string; bookings: number; guests: number }[]
  topDishes: Dish[]
}

export const WEEKDAY_LABELS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön']

/** Måndag = 0. */
export function weekdayOf(iso: string): number {
  return (parseDay(iso).getDay() + 6) % 7
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}

export function summarize(days: DayData[], catering: RequestSummary[], range: { from: string; to: string }): Summary {
  const inRange = (iso: string | undefined) => !!iso && iso.slice(0, 10) >= range.from && iso.slice(0, 10) <= range.to
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))

  let orderRevenue = 0
  let pickupRevenue = 0
  let tableRevenue = 0
  let orders = 0
  let bookings = 0
  let guests = 0
  let noShows = 0
  let cancelled = 0
  let cardOnFile = 0
  const source = { online: 0, phone: 0, onsite: 0 }
  const hours = new Map<number, number>()
  const weekdays = WEEKDAY_LABELS.map((label, weekday) => ({ weekday, label, bookings: 0, guests: 0 }))
  const dishes = new Map<string, Dish>()
  const byDay: DayPoint[] = []

  for (const day of sorted) {
    const point: DayPoint = { date: day.date, revenue: 0, orders: 0, bookings: 0, guests: 0 }
    for (const r of day.reservations) {
      if (CANCELLED.has(r.status)) {
        cancelled++
        continue
      }
      bookings++
      guests += r.partySize
      point.bookings++
      point.guests += r.partySize
      if (NO_SHOW.has(r.status)) noShows++
      if (r.cardOnFile) cardOnFile++
      if (r.source === 'phone') source.phone++
      else if (r.source === 'walk_in' || r.source === 'staff') source.onsite++
      else source.online++
      const hour = Number.parseInt(r.startTime, 10)
      if (Number.isFinite(hour)) hours.set(hour, (hours.get(hour) ?? 0) + 1)
      const wd = weekdays[weekdayOf(day.date)]
      wd.bookings++
      wd.guests += r.partySize
    }
    for (const o of day.orders) {
      if (!isPaidOrder(o)) continue
      orders++
      orderRevenue += o.totalAmount
      point.orders++
      point.revenue += o.totalAmount
      if (o.mode === 'table') tableRevenue += o.totalAmount
      else pickupRevenue += o.totalAmount
      for (const line of o.lines) {
        const dish = dishes.get(line.name) ?? { name: line.name, quantity: 0, revenue: 0 }
        dish.quantity += line.quantity
        dish.revenue += line.total
        dishes.set(line.name, dish)
      }
    }
    byDay.push(point)
  }

  let cateringRevenue = 0
  let cateringWon = 0
  let cateringRequests = 0
  for (const c of catering) {
    if (inRange(c.createdAt)) cateringRequests++
    if (CATERING_WON.has(c.status) && inRange(c.deliveryDate)) {
      cateringWon++
      cateringRevenue += c.total ?? 0
    }
  }

  const byHour = [...hours.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, count]) => ({ hour, bookings: count }))
  const topDishes = [...dishes.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name, 'sv'))
    .slice(0, 8)

  return {
    from: range.from,
    to: range.to,
    days: daysBetween(range.from, range.to),
    revenue: orderRevenue + cateringRevenue,
    orderRevenue,
    cateringRevenue,
    pickupRevenue,
    tableRevenue,
    orders,
    avgOrder: orders > 0 ? Math.round(orderRevenue / orders) : null,
    bookings,
    guests,
    avgParty: bookings > 0 ? guests / bookings : null,
    completed: bookings - noShows,
    noShows,
    cancelled,
    noShowPct: pct(noShows, bookings),
    cancelledPct: pct(cancelled, bookings + cancelled),
    cardOnFilePct: pct(cardOnFile, bookings),
    source,
    cateringRequests,
    cateringWon,
    byDay,
    byHour,
    byWeekday: weekdays,
    topDishes,
  }
}

/* --- Jämförelser och text ------------------------------------------------ */

/** Förändring i procent mot förra perioden; null när det inte går att jämföra. */
export function deltaPct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

/** "Omsättningen upp 12 %"-rubrik; bara basen när det inte går att jämföra. */
export function insightTitle(base: string, pct: number | null, words: { up?: string; down?: string } = {}): string {
  if (pct === null || !Number.isFinite(pct)) return base
  if (Math.abs(pct) < 0.5) return `${base} oförändrad`
  return `${base} ${pct > 0 ? (words.up ?? 'upp') : (words.down ?? 'ned')} ${fmtPct(Math.abs(pct))}`
}

export function fmtKr(ore: number | null | undefined): string {
  if (ore == null || !Number.isFinite(ore)) return '-'
  return `${Math.round(ore / 100).toLocaleString('sv-SE')} kr`
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return Math.round(n).toLocaleString('sv-SE')
}

export function fmtDecimal(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  const digits = Math.abs(n) < 10 && Math.abs(n) !== 0 ? 1 : 0
  return `${n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: digits })} %`
}

/** "21 okt" */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(parseDay(iso)).replace('.', '')
}

/** "21 okt till 19 nov" */
export function rangeLabel(from: string, to: string): string {
  return `${shortDate(from)} till ${shortDate(to)}`
}
