import { listReservations } from '../bokningar/bookingsApi'
import { listOrders } from '../bestallningar/ordersApi'
import type { DayData } from './stats'

/**
 * Hämtar underlaget till Statistik: bokningar och beställningar dag för dag
 * (API:t har inga sammanställningar, bara dagslistor). Några dagar i taget
 * så att en period på en månad inte blir sextio anrop på en gång mot
 * Lambda-kvoten, och varje dag cachas i fliken: gårdagen ändras sällan,
 * dagens siffror får bli en minut gamla.
 */

const cache = new Map<string, { at: number; data: DayData }>()
const TODAY_TTL_MS = 60_000
const PAST_TTL_MS = 30 * 60_000

export function clearStatsCache(): void {
  cache.clear()
}

async function loadDay(locationId: string, date: string): Promise<{ data: DayData; complete: boolean }> {
  const [reservations, orders] = await Promise.all([
    listReservations(locationId, date).catch(() => null),
    listOrders(locationId, date).then((r) => r.orders).catch(() => null),
  ])
  return {
    data: { date, reservations: reservations ?? [], orders: orders ?? [] },
    complete: reservations !== null && orders !== null,
  }
}

export interface LoadResult {
  days: DayData[]
  /** Dagar där något anrop misslyckades (visas som ofullständigt). */
  failed: number
}

export async function loadDays(
  locationId: string,
  dates: string[],
  options: { today: string; concurrency?: number; onProgress?: (done: number, total: number) => void; now?: () => number } = {
    today: '',
  },
): Promise<LoadResult> {
  const { today, concurrency = 4, onProgress, now = Date.now } = options
  const out = new Map<string, DayData>()
  let failed = 0
  let done = 0
  const queue = [...dates]

  async function worker() {
    for (let date = queue.shift(); date !== undefined; date = queue.shift()) {
      const key = `${locationId}|${date}`
      const hit = cache.get(key)
      const ttl = date === today ? TODAY_TTL_MS : PAST_TTL_MS
      if (hit && now() - hit.at < ttl) {
        out.set(date, hit.data)
      } else {
        const { data, complete } = await loadDay(locationId, date)
        if (complete) cache.set(key, { at: now(), data })
        else failed++
        out.set(date, data)
      }
      done++
      onProgress?.(done, dates.length)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, dates.length)) }, worker))
  return { days: dates.map((d) => out.get(d)!), failed }
}
