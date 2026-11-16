import { DATA_CHANGED_EVENT, apiFetch } from '../../shared/api'
import type { Filters } from './insights'
import type { InsightsResponse } from './insights'

/**
 * GET /insights: ett anrop för hela perioden och jämförelsen, oavsett om
 * det är en dag eller ett år (servern läser dagliga sammanställningar och
 * räknar dagen idag direkt). Svaret cachas en minut i fliken, så att byte
 * fram och tillbaka mellan filter inte hämtar samma siffror igen; varje
 * skrivning i appen (en ny bokning, en avbokning, en beställning) tömmer
 * cachen, så nästa visning räknar om.
 */

const cache = new Map<string, { at: number; data: InsightsResponse }>()
const TTL_MS = 60_000

export function clearInsightsCache(): void {
  cache.clear()
}

if (typeof window !== 'undefined') window.addEventListener(DATA_CHANGED_EVENT, clearInsightsCache)

export type InsightsQuery = Pick<Filters, 'from' | 'to' | 'locationId' | 'service' | 'channel' | 'compare'> & {
  /** Även bokningarna så många dagar efter idag (upcoming). */
  ahead?: number
}

export function insightsQuery(f: InsightsQuery): string {
  const q = new URLSearchParams({
    from: f.from,
    to: f.to,
    locationId: f.locationId,
    service: f.service,
    channel: f.channel,
    compare: f.compare,
  })
  if (f.ahead) q.set('ahead', String(f.ahead))
  return `/insights?${q.toString()}`
}

export async function fetchInsights(
  f: InsightsQuery,
  { now = Date.now, fresh = false }: { now?: () => number; fresh?: boolean } = {},
): Promise<InsightsResponse> {
  const path = insightsQuery(f)
  const hit = cache.get(path)
  if (!fresh && hit && now() - hit.at < TTL_MS) return hit.data
  const data = await apiFetch<InsightsResponse>(path)
  cache.set(path, { at: now(), data })
  return data
}
