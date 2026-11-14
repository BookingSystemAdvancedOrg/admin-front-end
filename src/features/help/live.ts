import { isApiConfigured } from '../../shared/api'
import { todayIn } from '../bokningar/bookingsApi'
import { presetRange } from '../statistik/insights'
import type { InsightsResponse, InsightsSummary } from '../statistik/insights'
import { fetchInsights } from '../statistik/insightsApi'
import { sampleInsights } from '../statistik/insightsSample'

/**
 * Levande siffror i assistentens svar ("Hur många gäster har vi haft
 * idag?"). Hämtas med användarens egen inloggning från samma API som
 * Statistik (GET /insights), så servern avgör restaurang, plats och roll:
 * personalen får aldrig belopp. Bara läsning. Utan API visas exempelsiffror,
 * som på Statistik.
 */

/** 'range': bara med datumen som servern tolkat ur frågan (imorgon, på fredag, nästa vecka). */
type Period = 'today' | 'week' | 'month' | 'range'
type Metric = { period: Period; money?: boolean; value: (s: InsightsSummary) => number | null | undefined; format: 'int' | 'pct' | 'kr' }

export const METRICS: Record<string, Metric> = {
  guestsToday: { period: 'today', value: (s) => s.guests, format: 'int' },
  bookingsToday: { period: 'today', value: (s) => s.bookings, format: 'int' },
  arrivedToday: { period: 'today', value: (s) => s.arrived, format: 'int' },
  occupancyToday: { period: 'today', value: (s) => s.occupancy, format: 'pct' },
  noShowsToday: { period: 'today', value: (s) => s.noShows, format: 'int' },
  ordersToday: { period: 'today', value: (s) => s.orders, format: 'int' },
  revenueToday: { period: 'today', money: true, value: (s) => s.revenue, format: 'kr' },
  guestsWeek: { period: 'week', value: (s) => s.guests, format: 'int' },
  bookingsWeek: { period: 'week', value: (s) => s.bookings, format: 'int' },
  guestsMonth: { period: 'month', value: (s) => s.guests, format: 'int' },
  bookingsMonth: { period: 'month', value: (s) => s.bookings, format: 'int' },
  revenueMonth: { period: 'month', money: true, value: (s) => s.revenue, format: 'kr' },
  guests: { period: 'range', value: (s) => s.guests, format: 'int' },
  bookings: { period: 'range', value: (s) => s.bookings, format: 'int' },
  arrived: { period: 'range', value: (s) => s.arrived, format: 'int' },
  occupancy: { period: 'range', value: (s) => s.occupancy, format: 'pct' },
  noShows: { period: 'range', value: (s) => s.noShows, format: 'int' },
  orders: { period: 'range', value: (s) => s.orders, format: 'int' },
  revenue: { period: 'range', money: true, value: (s) => s.revenue, format: 'kr' },
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** Längsta perioden assistenten frågar efter (servern tolkar högst en vecka). */
const MAX_RANGE_DAYS = 31

function validRange(range: { from: string; to: string } | undefined): range is { from: string; to: string } {
  if (!range || !DAY.test(range.from) || !DAY.test(range.to) || range.from > range.to) return false
  const days = (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000
  return Number.isFinite(days) && days < MAX_RANGE_DAYS
}

/**
 * Texten med siffran: {value} blir siffran och {en|flera} ental när siffran
 * är 1, annars flertal ("1 bokning", "2 bokningar", "1 gäst är markerad").
 */
export function fillLive(text: string, value: number, shown: string): string {
  return text.replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, one: string, many: string) => (value === 1 ? one : many)).replace('{value}', shown)
}

function format(value: number, kind: Metric['format']): string {
  if (kind === 'pct') return `${Math.round(value)} %`
  const n = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(value)
  return kind === 'kr' ? `${n} kr` : n
}

/** Svarets text med siffran insatt ({value}), eller null när den inte går att få. */
export async function resolveLive(
  live: { metric: string; text: string; range?: { from: string; to: string } },
  ctx: { locationId: string | null; timezone: string | null; isOwner: boolean; fetch?: typeof fetchInsights },
): Promise<string | null> {
  const metric = METRICS[live.metric]
  const mock = !isApiConfigured() && !ctx.fetch
  // Utan API: exempelsiffror för exempelplatsen, som på Statistik.
  const locationId = ctx.locationId ?? (mock ? 'exempel' : null)
  if (!metric || !locationId) return null
  if (metric.money && !ctx.isOwner) return null
  const today = todayIn(ctx.timezone)
  let range: { from: string; to: string }
  if (metric.period === 'range') {
    if (!validRange(live.range)) return null
    range = { from: live.range.from, to: live.range.to }
  } else range = metric.period === 'today' ? { from: today, to: today } : presetRange(metric.period, today)
  const filters = { ...range, locationId, service: 'all' as const, channel: 'all' as const, compare: 'none' as const }
  let data: InsightsResponse
  if (mock) data = sampleInsights({ ...filters, preset: metric.period === 'range' ? 'custom' : metric.period }, today, ctx.isOwner)
  else data = await (ctx.fetch ?? fetchInsights)(filters)
  if (metric.money && !data.money) return null
  const value = metric.value(data.current)
  if (value === null || value === undefined) return null
  return fillLive(live.text, value, format(value, metric.format))
}
