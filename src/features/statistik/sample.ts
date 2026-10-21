import type { Reservation, ReservationSource, ReservationStatus } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { RequestSummary } from '../catering/cateringApi'
import { addDays, datesIn, weekdayOf } from './stats'
import type { DayData } from './stats'

/**
 * Exempeldata för Statistik: två månader på en påhittad restaurang, samma
 * varje gång (sådd slumpgenerator per dag), så att sidan går att visa upp
 * utan riktiga siffror. Bara när exempelläget är på (Översiktens val).
 */

function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedOf(iso: string): number {
  let h = 2166136261
  for (const ch of iso) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

const DISHES: [string, number][] = [
  ['Pizza Margherita', 16500],
  ['Pizza Diavola', 18500],
  ['Pasta al limone', 18500],
  ['Grillad lax', 24500],
  ['Entrecôte', 32500],
  ['Burgare & pommes', 16500],
  ['Caesarsallad', 14500],
  ['Tiramisu', 9500],
  ['Husets rött, glas', 7500],
  ['Mineralvatten', 3500],
]

const NAMES = ['Maria', 'Johan', 'Sara', 'Elin', 'Omar', 'Anna', 'Lisa', 'Daniel', 'Karin', 'Mats', 'Hanna', 'Viktor']

function pick<T>(rnd: () => number, items: T[]): T {
  return items[Math.floor(rnd() * items.length)]
}

/** Kvällstopp runt 18-19, en liten lunchpuckel. */
function bookingHour(rnd: () => number): number {
  const r = rnd()
  if (r < 0.2) return 11 + Math.floor(rnd() * 3)
  if (r < 0.45) return 17
  if (r < 0.75) return 18
  if (r < 0.92) return 19
  return 20
}

export function sampleDay(date: string, today: string): DayData {
  const rnd = seeded(seedOf(date))
  const wd = weekdayOf(date)
  const weekend = wd >= 4
  const past = date < today
  const nBookings = Math.round((weekend ? 11 : 6) + rnd() * (weekend ? 6 : 4))
  const reservations: Reservation[] = []
  for (let i = 0; i < nBookings; i++) {
    const hour = bookingHour(rnd)
    const minute = rnd() < 0.5 ? '00' : '30'
    const r = rnd()
    let status: ReservationStatus = 'reserved'
    if (past) status = r < 0.06 ? 'no_show' : r < 0.14 ? 'cancelled_no_charge' : r < 0.9 ? 'arrived' : 'reserved'
    else if (r < 0.05) status = 'cancelled_no_charge'
    const s = rnd()
    const source: ReservationSource = s < 0.72 ? 'online' : s < 0.9 ? 'phone' : s < 0.96 ? 'walk_in' : 'staff'
    const partySize = 2 + Math.floor(rnd() * rnd() * 7)
    reservations.push({
      reservationId: `sample-${date}-${i}`,
      locationId: 'sample',
      date,
      startTime: `${String(hour).padStart(2, '0')}:${minute}`,
      endTime: `${String(hour + 2).padStart(2, '0')}:${minute}`,
      tableIds: [],
      partySize,
      customerName: pick(rnd, NAMES),
      status,
      source,
      cardOnFile: partySize >= 6 || rnd() < 0.3,
    })
  }
  const nOrders = past || date === today ? Math.round((weekend ? 16 : 9) + rnd() * 8) : 0
  const orders: Order[] = []
  for (let i = 0; i < nOrders; i++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, j) => {
      const [name, unitPrice] = pick(rnd, DISHES)
      const quantity = 1 + Math.floor(rnd() * 2)
      return { menuItemId: `sample-item-${j}`, name, unitPrice, quantity, total: unitPrice * quantity, vatRate: 12 }
    })
    orders.push({
      orderId: `sample-${date}-o${i}`,
      locationId: 'sample',
      number: 100 + i,
      status: 'completed',
      paymentStatus: 'paid',
      mode: rnd() < 0.6 ? 'pickup' : 'table',
      lines,
      totalAmount: lines.reduce((sum, l) => sum + l.total, 0),
    })
  }
  return { date, reservations, orders }
}

export function sampleDays(from: string, to: string, today: string): DayData[] {
  return datesIn(from, to).map((d) => sampleDay(d, today))
}

/** Cateringförfrågningar runt perioden: en i veckan, varannan vunnen. */
export function sampleCatering(from: string, to: string): RequestSummary[] {
  const out: RequestSummary[] = []
  const start = addDays(from, -35)
  let i = 0
  for (let d = start; d <= to; d = addDays(d, 7)) {
    const rnd = seeded(seedOf(`catering-${d}`))
    const delivery = addDays(d, 12)
    const won = i % 2 === 0
    out.push({
      requestId: `sample-cat-${i}`,
      status: delivery > to ? (won ? 'confirmed' : 'offer_sent') : won ? 'delivered' : 'declined',
      customerType: rnd() < 0.7 ? 'company' : 'private',
      customerName: pick(rnd, NAMES),
      deliveryDate: delivery,
      deliveryTime: '11:30',
      fulfilment: rnd() < 0.5 ? 'delivery' : 'pickup',
      createdAt: `${d}T09:00:00`,
      portions: 20 + Math.floor(rnd() * 40),
      total: won ? 800000 + Math.floor(rnd() * 20) * 100000 : undefined,
    })
    i++
  }
  return out
}
