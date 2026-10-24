import { channelLabel } from '../marknadsforing/marketingApi'
import { addDays, daysBetween, fmtDecimal, fmtInt, fmtPct, isoDay, parseDay } from './stats'

/**
 * Statistik: typerna för GET /insights, perioderna och filtren i adressen,
 * "Att göra"-signalerna och CSV-exporten. Ren logik utan React, så den går
 * att testa direkt. Siffrorna räknas på servern (application/shared/
 * insights.py); belopp är i öre och saknas helt för personal.
 */

/* --- Svaret från API:t ------------------------------------------------------ */

export interface DayPoint {
  date: string
  bookings: number
  guests: number
  orders: number
  noShows: number
  cancelled: number
  visits: number
  occupancy: number | null
  revenue?: number
  orderRevenue?: number
  cateringRevenue?: number
}

export interface Dish {
  id: string
  name: string
  quantity: number
  revenue?: number
  previousQuantity?: number
}

export interface WebChannel {
  channel: string
  visits: number
  bookings: number
  orders: number
  catering: number
  conversionPct: number | null
}

export interface InsightsSummary {
  bookings: number
  guests: number
  avgParty: number | null
  arrived: number
  noShows: number
  noShowPct: number | null
  cancelled: number
  cancelledPct: number | null
  lateCancels: number
  lateCancelPct: number | null
  cardOnFilePct: number | null
  occupancy: number | null
  seatFill: number | null
  sources: { online: number; phone: number; onsite: number }
  lead: { label: string; bookings: number }[]
  party: { size: number; bookings: number }[]
  bySize: { size: string; occupancy: number | null }[]
  feeCount: number
  feesFailed: number
  feesCharged?: number
  feesRefunded?: number
  orders: number
  tableOrders: number
  orderRevenue?: number
  tableRevenue?: number
  pickupRevenue?: number
  avgOrder?: number | null
  prepMinutes: number | null
  latePct: number | null
  cateringRevenue?: number
  revenue?: number
  /** Kortköp i kassan (Ta betalt): antal och belopp, alla. */
  cardPayments?: number
  cardRevenue?: number
  /** Den del av kortköpen som inte är en beställnings (ingår i revenue). */
  inPersonRevenue?: number
  cardRefunds?: number
  cardRefunded?: number
  catering: {
    requests: number
    offers: number
    won: number
    delivered: number
    replyHours: number | null
    conversionPct: number | null
    cateringRevenue?: number
    avgCatering?: number | null
  }
  web: {
    visits: number
    pageviews: number
    bookings: number
    orders: number
    catering: number
    conversionPct: number | null
    channels: WebChannel[]
  }
  dishes: Dish[]
  pairs: { a: string; b: string; orders: number }[]
  byHour: { hour: number; bookings: number; guests: number; orders: number }[]
  byWeekday: { weekday: number; bookings: number; guests: number; orders: number; occupancy: number | null }[]
  byDay: DayPoint[]
  heat: { weekday: number; hour: number; occupancy: number | null }[]
}

export interface InsightsResponse {
  range: { from: string; to: string }
  compare: { mode: CompareMode; from?: string; to?: string }
  filters: { locationId: string; service: Service; channel: Channel }
  locations: { locationId: string; name: string | null; lunchUntil: string }[]
  money: boolean
  pending: boolean
  builtAt: string | null
  current: InsightsSummary
  previous: InsightsSummary | null
}

/* --- Filtren ------------------------------------------------------------------ */

export type PresetId = 'today' | 'week' | 'd30' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'custom'
export type Service = 'all' | 'lunch' | 'dinner'
export type Channel = 'all' | 'online' | 'phone' | 'onsite'
export type CompareMode = 'previous' | 'year' | 'none'

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'today', label: 'Idag' },
  { id: 'week', label: 'Denna vecka' },
  { id: 'd30', label: '30 dagar' },
  { id: 'month', label: 'Denna månad' },
  { id: 'lastMonth', label: 'Förra månaden' },
  { id: 'quarter', label: 'Kvartal' },
  { id: 'year', label: 'År' },
  { id: 'custom', label: 'Anpassat' },
]

export const SERVICES: { id: Service; label: string }[] = [
  { id: 'all', label: 'Hela dagen' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Middag' },
]

export const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'all', label: 'Alla kanaler' },
  { id: 'online', label: 'Online' },
  { id: 'phone', label: 'Telefon' },
  { id: 'onsite', label: 'På plats' },
]

export const COMPARES: { id: CompareMode; label: string }[] = [
  { id: 'previous', label: 'Föregående period' },
  { id: 'year', label: 'Samma period förra året' },
  { id: 'none', label: 'Ingen jämförelse' },
]

/** Längsta period API:t räknar (två år). */
export const MAX_DAYS = 731

export interface Filters {
  preset: PresetId
  from: string
  to: string
  locationId: string
  service: Service
  channel: Channel
  compare: CompareMode
}

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(parseDay(v).getTime())

/** Perioden för ett val, räknad från platsens datum idag. */
export function presetRange(preset: Exclude<PresetId, 'custom'>, today: string): { from: string; to: string } {
  const t = parseDay(today)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'week':
      return { from: addDays(today, -((t.getDay() + 6) % 7)), to: today }
    case 'd30':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: today }
    case 'lastMonth':
      return {
        from: isoDay(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
        to: isoDay(new Date(t.getFullYear(), t.getMonth(), 0)),
      }
    case 'quarter':
      return { from: isoDay(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)), to: today }
    case 'year':
      return { from: isoDay(new Date(t.getFullYear(), 0, 1)), to: today }
  }
}

function pick<T extends string>(value: string | null, options: { id: T }[], fallback: T): T {
  return options.some((o) => o.id === value) ? (value as T) : fallback
}

/** Filtren ur adressen (?period=month&loc=...); okända värden blir standard. */
export function filtersFrom(params: URLSearchParams, today: string, fallbackLocation: string): Filters {
  const preset = pick(params.get('period'), PRESETS, 'd30')
  let range = preset === 'custom' ? null : presetRange(preset, today)
  if (preset === 'custom') {
    const from = params.get('from')
    const to = params.get('to')
    if (isDay(from) && isDay(to) && from <= to) {
      const end = to > today ? today : to
      const start = daysBetween(from, end) > MAX_DAYS ? addDays(end, -(MAX_DAYS - 1)) : from
      range = { from: start > end ? end : start, to: end }
    } else {
      range = presetRange('d30', today)
    }
  }
  return {
    preset,
    ...range!,
    locationId: params.get('loc') || fallbackLocation,
    service: pick(params.get('service'), SERVICES, 'all'),
    channel: pick(params.get('channel'), CHANNELS, 'all'),
    compare: pick(params.get('compare'), COMPARES, 'previous'),
  }
}

/** Filtren tillbaka till adressen; standardvärden skrivs inte ut. */
export function filtersToParams(f: Filters, defaultLocation: string): URLSearchParams {
  const p = new URLSearchParams()
  p.set('period', f.preset)
  if (f.preset === 'custom') {
    p.set('from', f.from)
    p.set('to', f.to)
  }
  if (f.locationId !== defaultLocation) p.set('loc', f.locationId)
  if (f.service !== 'all') p.set('service', f.service)
  if (f.channel !== 'all') p.set('channel', f.channel)
  if (f.compare !== 'previous') p.set('compare', f.compare)
  return p
}

/** Hur många filter som avviker från standard (mobilens "Filter (2)"). */
export function activeFilterCount(f: Filters, defaultLocation: string): number {
  return [f.locationId !== defaultLocation, f.service !== 'all', f.channel !== 'all', f.compare !== 'previous'].filter(Boolean)
    .length
}

export function compareLabel(mode: CompareMode): string {
  return mode === 'year' ? 'samma period förra året' : mode === 'none' ? '' : 'förra perioden'
}

/* --- Text --------------------------------------------------------------------- */

export const WEEKDAY_LABELS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön']
const WEEKDAY_PLURAL = ['måndagar', 'tisdagar', 'onsdagar', 'torsdagar', 'fredagar', 'lördagar', 'söndagar']

export const LEAD_LABELS: Record<string, string> = {
  '0': 'Samma dag',
  '1': 'Dagen före',
  '2-6': '2-6 dagar',
  '7-13': '1-2 veckor',
  '14+': 'Mer än 2 veckor',
}

export const SIZE_LABELS: Record<string, string> = { '2': '2-bord', '4': '4-bord', '6': '6-bord', '8': 'Större bord' }

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

/* --- Att göra --------------------------------------------------------------- */

export interface Signal {
  id: string
  /** Högre = viktigare; de tre starkaste visas. */
  weight: number
  title: string
  text: string
  to: string
  linkLabel: string
}

/** Lägsta och högsta beläggningen per veckodag och pass ur värmekartan. */
function servicePasses(s: InsightsSummary, split: number) {
  const passes = new Map<string, { weekday: number; service: 'lunch' | 'dinner'; sum: number; n: number }>()
  for (const c of s.heat) {
    if (c.occupancy === null) continue
    const service = c.hour < split ? 'lunch' : 'dinner'
    const key = `${c.weekday}|${service}`
    const p = passes.get(key) ?? { weekday: c.weekday, service, sum: 0, n: 0 }
    p.sum += c.occupancy
    p.n += 1
    passes.set(key, p)
  }
  return [...passes.values()].map((p) => ({ ...p, occupancy: p.sum / p.n }))
}

/**
 * De starkaste signalerna i perioden, med vad man kan göra åt dem. Regler,
 * inte gissningar: varje signal kräver tillräckligt underlag.
 */
export function signals(
  s: InsightsSummary,
  previous: InsightsSummary | null,
  { split = 15, marketing = false }: { split?: number; marketing?: boolean } = {},
): Signal[] {
  const out: Signal[] = []
  const kept = s.bookings

  if (kept >= 20 && s.noShowPct !== null && s.noShowPct >= 5) {
    out.push({
      id: 'noshow',
      weight: 50 + s.noShowPct,
      title: `${fmtPct(s.noShowPct)} av gästerna kom inte`,
      text: 'Kräv kortgaranti för större sällskap och skicka en påminnelse dagen före.',
      to: '/installningar',
      linkLabel: 'Ställ in kortgaranti',
    })
  }
  if (kept + s.cancelled >= 20 && s.lateCancelPct !== null && s.lateCancelPct >= 5) {
    out.push({
      id: 'latecancel',
      weight: 40 + s.lateCancelPct,
      title: `${fmtPct(s.lateCancelPct)} avbokas sent`,
      text: 'Flytta gränsen för fri avbokning eller ta en avgift för sena avbokningar.',
      to: '/installningar',
      linkLabel: 'Till avbokningsreglerna',
    })
  }
  const passes = servicePasses(s, split).filter((p) => p.n >= 2)
  if (kept >= 20 && passes.length > 1) {
    const low = passes.reduce((a, b) => (b.occupancy < a.occupancy ? b : a))
    const high = passes.reduce((a, b) => (b.occupancy > a.occupancy ? b : a))
    const name = (p: typeof low) => `${WEEKDAY_PLURAL[p.weekday]} ${p.service === 'lunch' ? 'till lunch' : 'till middag'}`
    if (low.occupancy < 40) {
      out.push({
        id: 'lowpass',
        weight: 45 + (40 - low.occupancy),
        title: `Tomt på ${name(low)}`,
        text: `Borden är bara ${fmtPct(low.occupancy)} bokade då. ${marketing ? 'Skicka ett erbjudande till prenumeranterna för just det passet.' : 'Prova ett erbjudande eller en meny för just det passet.'}`,
        to: marketing ? '/marknadsforing' : '/meny',
        linkLabel: marketing ? 'Skapa ett utskick' : 'Till menyn',
      })
    }
    if (high.occupancy >= 85) {
      out.push({
        id: 'fullpass',
        weight: 35 + (high.occupancy - 85),
        title: `Fullt på ${name(high)}`,
        text: `${fmtPct(high.occupancy)} av bordstiden är bokad. Korta bordstiden eller flytta gäster till kvällens första sittning.`,
        to: '/installningar',
        linkLabel: 'Ändra bordstid',
      })
    }
  }
  const lateLead = (s.lead[0]?.bookings ?? 0) + (s.lead[1]?.bookings ?? 0)
  if (kept >= 30 && lateLead / kept >= 0.5) {
    out.push({
      id: 'lead',
      weight: 30,
      title: `${fmtPct((lateLead / kept) * 100)} bokar samma dag eller dagen före`,
      text: 'Gästerna bestämmer sig sent. Lägg ut erbjudanden 1-2 dagar före, inte en vecka innan.',
      to: marketing ? '/marknadsforing' : '/bokningar',
      linkLabel: marketing ? 'Planera ett utskick' : 'Till bokningarna',
    })
  }
  const sourced = s.sources.online + s.sources.phone + s.sources.onsite
  if (sourced >= 30 && s.sources.phone / sourced >= 0.4) {
    out.push({
      id: 'phone',
      weight: 28,
      title: `${fmtPct((s.sources.phone / sourced) * 100)} bokar via telefon`,
      text: 'Lyft fram onlinebokningen på hemsidan och på Google, så slipper ni svara i telefon under rusningen.',
      to: '/marknadsforing',
      linkLabel: 'Se besöken på hemsidan',
    })
  }
  if (previous) {
    const falling = s.dishes
      .slice(0, 10)
      .filter((d) => (d.previousQuantity ?? 0) >= 10 && d.quantity < (d.previousQuantity ?? 0) * 0.7)
      .sort((a, b) => a.quantity / (a.previousQuantity || 1) - b.quantity / (b.previousQuantity || 1))[0]
    if (falling) {
      const drop = (1 - falling.quantity / (falling.previousQuantity || 1)) * 100
      out.push({
        id: 'dish',
        weight: 25 + drop / 4,
        title: `${falling.name} säljer ${fmtPct(drop)} mindre`,
        text: 'Kolla priset, bilden och var rätten står i menyn, eller byt ut den.',
        to: '/meny',
        linkLabel: 'Till menyn',
      })
    }
  }
  if (s.prepMinutes !== null && s.orders >= 20 && s.latePct !== null && s.latePct >= 20) {
    out.push({
      id: 'late',
      weight: 32 + s.latePct / 4,
      title: `${fmtPct(s.latePct)} av beställningarna blev klara sent`,
      text: `Det tar ${fmtDecimal(s.prepMinutes)} minuter i snitt. Lägg till några minuter i tidsestimatet vid rusning.`,
      to: '/installningar',
      linkLabel: 'Ändra tillagningstid',
    })
  }
  if (s.catering.offers >= 3 && s.catering.replyHours !== null && s.catering.replyHours > 24) {
    out.push({
      id: 'catering',
      weight: 27,
      title: `Det tar ${fmtInt(s.catering.replyHours)} timmar att svara på catering`,
      text: 'Svara inom ett dygn: snabba offerter vinner oftare.',
      to: '/catering',
      linkLabel: 'Till förfrågningarna',
    })
  }
  const weak = s.web.channels.find((c) => c.visits >= 100 && (c.conversionPct ?? 0) < 1 && c.channel !== 'direct')
  if (weak) {
    out.push({
      id: 'channel',
      weight: 22,
      title: `Många besök från ${channelLabel(weak.channel)}, få bokningar`,
      text: 'Se till att länken går direkt till bokningen eller beställningen, inte till startsidan.',
      to: '/marknadsforing',
      linkLabel: 'Till marknadsföringen',
    })
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 3)
}

/* --- CSV ---------------------------------------------------------------------- */

const csvNumber = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '' : v.toLocaleString('sv-SE', { maximumFractionDigits: digits, useGrouping: false })

/**
 * En rad per dag med de filter som är valda. Semikolon och decimalkomma,
 * som svenska Excel läser direkt; belopp i kronor, bara när de finns.
 */
export function toCsv(r: InsightsResponse): string {
  const money = r.money
  const head = ['Datum', 'Bokningar', 'Gäster', 'Uteblivna', 'Avbokade', 'Beläggning %', 'Beställningar']
  if (money) head.push('Beställningar kr', 'Catering kr', 'Omsättning kr')
  head.push('Besök')
  const rows = r.current.byDay.map((d) => {
    const cells = [d.date, csvNumber(d.bookings), csvNumber(d.guests), csvNumber(d.noShows), csvNumber(d.cancelled), csvNumber(d.occupancy, 1), csvNumber(d.orders)]
    if (money) cells.push(csvNumber((d.orderRevenue ?? 0) / 100, 2), csvNumber((d.cateringRevenue ?? 0) / 100, 2), csvNumber((d.revenue ?? 0) / 100, 2))
    cells.push(csvNumber(d.visits))
    return cells
  })
  const escape = (c: string) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
  return '﻿' + [head, ...rows].map((row) => row.map(escape).join(';')).join('\r\n') + '\r\n'
}

export function csvFileName(r: InsightsResponse, locationName: string | null): string {
  const slug = (locationName || 'alla-platser')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `statistik-${slug || 'plats'}-${r.range.from}-${r.range.to}.csv`
}
