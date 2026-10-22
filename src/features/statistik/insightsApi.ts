import { apiFetch } from '../../shared/api'
import type { Filters, InsightsResponse } from './insights'

/**
 * GET /insights: ett anrop för hela perioden och jämförelsen, oavsett om
 * det är en dag eller ett år (servern läser dagliga sammanställningar).
 * Svaret cachas en minut i fliken, så att byte fram och tillbaka mellan
 * filter och sidor inte hämtar samma siffror igen.
 */

const cache = new Map<string, { at: number; data: InsightsResponse }>()
const TTL_MS = 60_000

export function clearInsightsCache(): void {
  cache.clear()
}

export function insightsQuery(f: Pick<Filters, 'from' | 'to' | 'locationId' | 'service' | 'channel' | 'compare'>): string {
  const q = new URLSearchParams({
    from: f.from,
    to: f.to,
    locationId: f.locationId,
    service: f.service,
    channel: f.channel,
    compare: f.compare,
  })
  return `/insights?${q.toString()}`
}

export async function fetchInsights(
  f: Pick<Filters, 'from' | 'to' | 'locationId' | 'service' | 'channel' | 'compare'>,
  now: () => number = Date.now,
): Promise<InsightsResponse> {
  const path = insightsQuery(f)
  const hit = cache.get(path)
  if (hit && now() - hit.at < TTL_MS) return hit.data
  const data = await apiFetch<InsightsResponse>(path)
  cache.set(path, { at: now(), data })
  return data
}
