import { addDays, datesIn, daysBetween, weekdayOf } from './stats'
import type { Filters, InsightsResponse, InsightsSummary } from './insights'

/**
 * Exempeldata för Statistik: en påhittad restaurang med tolv bord, samma
 * siffror varje gång (sådd slumpgenerator per dag), i samma form som
 * GET /insights svarar. Visas när exempelläget är på (Översiktens val) och
 * när appen körs lokalt utan API. Filtren (pass, kanal, jämförelse) gäller
 * som på riktigt, så sidan går att visa upp med alla val.
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

function seedOf(text: string): number {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}

const DISHES: [string, string, number][] = [
  ['margherita', 'Pizza Margherita', 16500],
  ['diavola', 'Pizza Diavola', 18500],
  ['limone', 'Pasta al limone', 18500],
  ['lax', 'Grillad lax', 24500],
  ['entrecote', 'Entrecôte', 32500],
  ['burgare', 'Burgare & pommes', 16500],
  ['caesar', 'Caesarsallad', 14500],
  ['tiramisu', 'Tiramisu', 9500],
  ['rott', 'Husets rött, glas', 7500],
  ['vatten', 'Mineralvatten', 3500],
]
/** Rättvikter: pizzorna säljer mest, entrecôten minst. */
const DISH_WEIGHTS = [9, 6, 5, 3, 1.5, 5, 3, 4, 3, 4]
const TABLES: { size: string; count: number }[] = [
  { size: '2', count: 4 },
  { size: '4', count: 6 },
  { size: '6', count: 2 },
]
const TABLE_COUNT = TABLES.reduce((n, t) => n + t.count, 0)
const LUNCH = [11, 12, 13]
const DINNER = [17, 18, 19, 20, 21]
const WEEKDAY_LOAD = [0.55, 0.45, 0.65, 0.8, 1.15, 1.25, 0.7]
const WEB_CHANNELS = ['direct', 'google', 'instagram', 'facebook', 'email']

function weighted<T>(rnd: () => number, items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rnd() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

function empty(): InsightsSummary {
  return {
    bookings: 0, guests: 0, avgParty: null, arrived: 0, noShows: 0, noShowPct: null, cancelled: 0, cancelledPct: null,
    lateCancels: 0, lateCancelPct: null, cardOnFilePct: null, occupancy: null, seatFill: null,
    sources: { online: 0, phone: 0, onsite: 0 },
    lead: ['0', '1', '2-6', '7-13', '14+'].map((label) => ({ label, bookings: 0 })),
    party: [], bySize: [], feeCount: 0, feesFailed: 0, feesCharged: 0, feesRefunded: 0,
    orders: 0, tableOrders: 0, orderRevenue: 0, tableRevenue: 0, pickupRevenue: 0, avgOrder: null,
    prepMinutes: null, latePct: null, cateringRevenue: 0, revenue: 0,
    catering: { requests: 0, offers: 0, won: 0, delivered: 0, replyHours: null, conversionPct: null, cateringRevenue: 0, avgCatering: null },
    web: { visits: 0, pageviews: 0, bookings: 0, orders: 0, catering: 0, conversionPct: null, channels: [] },
    dishes: [], pairs: [], byHour: [],
    byWeekday: Array.from({ length: 7 }, (_, weekday) => ({ weekday, bookings: 0, guests: 0, orders: 0, occupancy: null })),
    byDay: [], heat: [],
  }
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)
/** Beläggning, högst 100 % (som servern). */
const fill = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 1000) / 10) : null)

export function sampleSummary(from: string, to: string, today: string, f: Pick<Filters, 'service' | 'channel'>): InsightsSummary {
  const s = empty()
  const inService = (h: number) => (f.service === 'lunch' ? h < 15 : f.service === 'dinner' ? h >= 15 : true)
  let cardOnFile = 0
  let seats = 0
  let bookedMin = 0
  let openMin = 0
  let prep = 0
  let prepN = 0
  let late = 0
  const sizeBooked: Record<string, number> = { '2': 0, '4': 0, '6': 0 }
  const sizeOpen: Record<string, number> = { '2': 0, '4': 0, '6': 0 }
  const party = new Map<number, number>()
  const hours = new Map<number, { hour: number; bookings: number; guests: number; orders: number }>()
  const heat = new Map<string, { b: number; o: number }>()
  const wdMin = Array.from({ length: 7 }, () => ({ b: 0, o: 0 }))
  const dishes = new Map<string, { id: string; name: string; quantity: number; revenue: number }>()
  const pairs = new Map<string, number>()
  const web = new Map<string, { channel: string; visits: number; bookings: number; orders: number; catering: number }>()
  let replyH = 0
  let replyN = 0

  for (const date of datesIn(from, to > today ? today : to)) {
    const rnd = seeded(seedOf(date))
    const wd = weekdayOf(date)
    const load = WEEKDAY_LOAD[wd] * (0.85 + rnd() * 0.3)
    const point = { date, bookings: 0, guests: 0, orders: 0, noShows: 0, cancelled: 0, visits: 0, occupancy: null as number | null, revenue: 0, orderRevenue: 0, cateringRevenue: 0 }
    let dayBooked = 0
    let dayOpen = 0
    for (const h of [...LUNCH, ...DINNER]) {
      if (!inService(h)) continue
      const minutes = 60 * TABLE_COUNT
      dayOpen += minutes
      const cell = heat.get(`${wd}|${h}`) ?? { b: 0, o: 0 }
      cell.o += minutes
      heat.set(`${wd}|${h}`, cell)
      for (const t of TABLES) sizeOpen[t.size] += 60 * t.count
    }
    const slots: [number, number][] = [
      ...LUNCH.map((h): [number, number] => [h, h === 12 ? 4 : 2]),
      ...DINNER.map((h): [number, number] => [h, h === 18 ? 6 : h === 19 ? 5 : h === 21 ? 1 : 3]),
    ]
    for (const [h, base] of slots) {
      const n = Math.round(base * load * (0.6 + rnd() * 0.8))
      for (let i = 0; i < n; i++) {
        const source = weighted(rnd, ['online', 'phone', 'onsite'] as const, [62, 28, 10])
        const size = weighted(rnd, [1, 2, 3, 4, 5, 6, 8], [4, 42, 14, 22, 7, 7, 4])
        const roll = rnd()
        if (!inService(h) || (f.channel !== 'all' && f.channel !== source)) continue
        if (roll < 0.07) {
          s.cancelled++
          point.cancelled++
          if (roll < 0.025) s.lateCancels++
          continue
        }
        s.bookings++
        s.guests += size
        s.sources[source]++
        point.bookings++
        point.guests += size
        party.set(Math.min(size, 8), (party.get(Math.min(size, 8)) ?? 0) + 1)
        const leadRoll = rnd()
        s.lead[leadRoll < 0.22 ? 0 : leadRoll < 0.4 ? 1 : leadRoll < 0.78 ? 2 : leadRoll < 0.93 ? 3 : 4].bookings++
        if (roll < 0.11) {
          s.noShows++
          point.noShows++
          if (rnd() < 0.5) {
            s.feeCount++
            s.feesCharged = (s.feesCharged ?? 0) + size * 25000
          }
        } else if (date < today) s.arrived++
        if (size >= 4) cardOnFile++
        const tableSize = size <= 2 ? '2' : size <= 4 ? '4' : '6'
        seats += Number(tableSize)
        const length = h < 15 ? 90 : 120
        const minutes = Math.min(length, 60 * (h < 15 ? 14 - h : 22 - h))
        dayBooked += minutes
        sizeBooked[tableSize] += minutes
        let left = minutes
        for (let hh = h; left > 0; hh++) {
          const part = Math.min(60, left)
          const cell = heat.get(`${wd}|${hh}`)
          if (cell) cell.b += part
          left -= part
        }
        const hour = hours.get(h) ?? { hour: h, bookings: 0, guests: 0, orders: 0 }
        hour.bookings++
        hour.guests += size
        hours.set(h, hour)
        s.byWeekday[wd].bookings++
        s.byWeekday[wd].guests += size
      }
    }
    // Beställningar: lunchtoppen 11-13, middag 17-20.
    for (const [h, base] of [[11, 2], [12, 4], [13, 1], [17, 3], [18, 4], [19, 3], [20, 1]] as [number, number][]) {
      const n = Math.round(base * load * (0.5 + rnd()))
      for (let i = 0; i < n; i++) {
        const lines = 1 + Math.floor(rnd() * 3)
        const picked = new Set<string>()
        let total = 0
        for (let l = 0; l < lines; l++) {
          const [id, name, price] = weighted(rnd, DISHES, DISH_WEIGHTS)
          const qty = 1 + (rnd() < 0.25 ? 1 : 0)
          picked.add(id)
          total += price * qty
          if (!inService(h)) continue
          const d = dishes.get(id) ?? { id, name, quantity: 0, revenue: 0 }
          d.quantity += qty
          d.revenue += price * qty
          dishes.set(id, d)
        }
        const table = rnd() < 0.35
        const minutes = 12 + Math.round(rnd() * 20)
        if (!inService(h)) continue
        s.orders++
        s.orderRevenue = (s.orderRevenue ?? 0) + total
        if (table) {
          s.tableOrders++
          s.tableRevenue = (s.tableRevenue ?? 0) + total
        } else s.pickupRevenue = (s.pickupRevenue ?? 0) + total
        prep += minutes
        prepN++
        if (minutes > 28) late++
        point.orders++
        point.orderRevenue += total
        const hour = hours.get(h) ?? { hour: h, bookings: 0, guests: 0, orders: 0 }
        hour.orders++
        hours.set(h, hour)
        s.byWeekday[wd].orders++
        const ids = [...picked].sort()
        for (let a = 0; a < ids.length; a++)
          for (let b = a + 1; b < ids.length; b++) pairs.set(`${ids[a]}|${ids[b]}`, (pairs.get(`${ids[a]}|${ids[b]}`) ?? 0) + 1)
      }
    }
    // Catering ungefär två gånger i veckan.
    if (rnd() < 0.3) {
      s.catering.requests++
      if (rnd() < 0.8) {
        s.catering.offers++
        replyH += 4 + Math.round(rnd() * 30)
        replyN++
        if (rnd() < 0.55) {
          s.catering.won++
          s.catering.delivered++
          const value = 350000 + Math.round(rnd() * 900000)
          s.catering.cateringRevenue = (s.catering.cateringRevenue ?? 0) + value
          point.cateringRevenue += value
        }
      }
    }
    for (const channel of WEB_CHANNELS) {
      const visits = Math.round((channel === 'direct' ? 45 : channel === 'google' ? 38 : channel === 'instagram' ? 22 : channel === 'facebook' ? 8 : 5) * load * (0.7 + rnd() * 0.6))
      const conv = channel === 'email' ? 0.12 : channel === 'instagram' ? 0.025 : channel === 'facebook' ? 0.006 : 0.05
      const w = web.get(channel) ?? { channel, visits: 0, bookings: 0, orders: 0, catering: 0 }
      w.visits += visits
      const won = Math.round(visits * conv)
      w.bookings += Math.round(won * 0.7)
      w.orders += won - Math.round(won * 0.7)
      web.set(channel, w)
      point.visits += visits
    }
    bookedMin += dayBooked
    openMin += dayOpen
    wdMin[wd].b += dayBooked
    wdMin[wd].o += dayOpen
    point.occupancy = fill(dayBooked, dayOpen)
    point.revenue = point.orderRevenue + point.cateringRevenue
    s.byDay.push(point)
  }

  s.avgParty = s.bookings ? Math.round((s.guests / s.bookings) * 100) / 100 : null
  s.noShowPct = pct(s.noShows, s.bookings)
  s.cancelledPct = pct(s.cancelled, s.bookings + s.cancelled)
  s.lateCancelPct = pct(s.lateCancels, s.bookings + s.cancelled)
  s.cardOnFilePct = pct(cardOnFile, s.bookings)
  s.occupancy = fill(bookedMin, openMin)
  s.seatFill = pct(s.guests, seats)
  s.party = [...party.entries()].sort((a, b) => a[0] - b[0]).map(([size, bookings]) => ({ size, bookings }))
  s.bySize = Object.keys(sizeOpen).filter((k) => sizeOpen[k] > 0).map((size) => ({ size, occupancy: fill(sizeBooked[size], sizeOpen[size]) }))
  s.avgOrder = s.orders ? Math.round((s.orderRevenue ?? 0) / s.orders) : null
  s.prepMinutes = prepN ? Math.round((prep / prepN) * 10) / 10 : null
  s.latePct = pct(late, prepN)
  s.cateringRevenue = s.catering.cateringRevenue ?? 0
  s.revenue = (s.orderRevenue ?? 0) + s.cateringRevenue
  s.catering.replyHours = replyN ? Math.round((replyH / replyN) * 10) / 10 : null
  s.catering.conversionPct = pct(s.catering.won, s.catering.offers)
  s.catering.avgCatering = s.catering.delivered ? Math.round(s.cateringRevenue / s.catering.delivered) : null
  const channels = [...web.values()].sort((a, b) => b.visits - a.visits)
  s.web = {
    visits: channels.reduce((n, c) => n + c.visits, 0),
    pageviews: Math.round(channels.reduce((n, c) => n + c.visits, 0) * 2.3),
    bookings: channels.reduce((n, c) => n + c.bookings, 0),
    orders: channels.reduce((n, c) => n + c.orders, 0),
    catering: 0,
    conversionPct: null,
    channels: channels.map((c) => ({ ...c, conversionPct: pct(c.bookings + c.orders, c.visits) })),
  }
  s.web.conversionPct = pct(s.web.bookings + s.web.orders, s.web.visits)
  s.dishes = [...dishes.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
  const names = new Map(DISHES.map(([id, name]) => [id, name]))
  s.pairs = [...pairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, orders]) => {
      const [a, b] = key.split('|')
      return { a: names.get(a) ?? a, b: names.get(b) ?? b, orders }
    })
  s.byHour = [...hours.values()].sort((a, b) => a.hour - b.hour)
  s.byWeekday.forEach((w, i) => (w.occupancy = fill(wdMin[i].b, wdMin[i].o)))
  s.heat = [...heat.entries()]
    .filter(([, c]) => c.o > 0)
    .map(([key, c]) => {
      const [weekday, hour] = key.split('|').map(Number)
      return { weekday, hour, occupancy: fill(c.b, c.o) }
    })
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour)
  return s
}

const MONEY = ['revenue', 'orderRevenue', 'cateringRevenue', 'tableRevenue', 'pickupRevenue', 'avgOrder', 'feesCharged', 'feesRefunded', 'cardRevenue', 'inPersonRevenue', 'cardRefunded'] as const

/** Personalens vy av exemplet: samma siffror utan belopp, som servern gör. */
function withoutMoney(s: InsightsSummary): InsightsSummary {
  const out = { ...s, catering: { ...s.catering } }
  for (const k of MONEY) delete out[k]
  delete out.catering.cateringRevenue
  delete out.catering.avgCatering
  out.dishes = s.dishes.map(({ revenue: _revenue, ...d }) => d)
  out.byDay = s.byDay.map(({ revenue: _r, orderRevenue: _o, cateringRevenue: _c, ...d }) => d)
  return out
}

function yearBack(iso: string): string {
  const [y, m, d] = iso.split('-')
  return m === '02' && d === '29' ? `${Number(y) - 1}-02-28` : `${Number(y) - 1}-${m}-${d}`
}

export function sampleInsights(f: Filters, today: string, money: boolean, locationName = 'Exempelrestaurangen'): InsightsResponse {
  const n = daysBetween(f.from, f.to)
  const compare =
    f.compare === 'none'
      ? null
      : f.compare === 'year'
        ? { from: yearBack(f.from), to: yearBack(f.to) }
        : { from: addDays(f.from, -n), to: addDays(f.from, -1) }
  const current = sampleSummary(f.from, f.to, today, f)
  const previous = compare ? sampleSummary(compare.from, compare.to, today, f) : null
  if (previous) {
    const before = new Map(previous.dishes.map((d) => [d.id, d.quantity]))
    current.dishes = current.dishes.map((d) => ({ ...d, previousQuantity: before.get(d.id) ?? 0 }))
  }
  return {
    range: { from: f.from, to: f.to },
    compare: compare ? { mode: f.compare, ...compare } : { mode: 'none' },
    filters: { locationId: f.locationId, service: f.service, channel: f.channel },
    locations: [{ locationId: f.locationId, name: locationName, lunchUntil: '15:00' }],
    money,
    pending: false,
    builtAt: null,
    current: money ? current : withoutMoney(current),
    previous: previous ? (money ? previous : withoutMoney(previous)) : null,
  }
}
