import { daysAgo, listCalls, today } from './api'

// One request per location (the last 31 days of calls), shared by every row on
// the page, instead of one request per booking.
const cache = new Map<string, Promise<Map<string, string>>>()

export function bookedByPhone(locationId: string): Promise<Map<string, string>> {
  let hit = cache.get(locationId)
  if (!hit) {
    hit = (async () => {
      const out = new Map<string, string>()
      let cursor: string | null = null
      for (let page = 0; page < 10; page += 1) {
        const res: Awaited<ReturnType<typeof listCalls>> = await listCalls(locationId, daysAgo(30), today(), cursor)
        res.calls.forEach((c) => { if (c.reservationId) out.set(c.reservationId, c.callId) })
        cursor = res.cursor
        if (!cursor) break
      }
      return out
    })().catch(() => new Map<string, string>())
    cache.set(locationId, hit)
    window.setTimeout(() => cache.delete(locationId), 60_000)
  }
  return hit
}

export function resetCallBadgeCacheForTests() {
  cache.clear()
}
