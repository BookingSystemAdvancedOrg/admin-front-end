import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStatsCache, loadDays } from './statsApi'
import * as bookings from '../bokningar/bookingsApi'
import * as orders from '../bestallningar/ordersApi'

describe('loadDays', () => {
  beforeEach(() => clearStatsCache())
  afterEach(() => vi.restoreAllMocks())

  it('fetches every day a few at a time, reports progress and caches past days', async () => {
    let inFlight = 0
    let peak = 0
    const reservations = vi.spyOn(bookings, 'listReservations').mockImplementation(async (_l, date) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return [{ reservationId: date, locationId: 'l', date, startTime: '18:00', endTime: '20:00', tableIds: [], partySize: 2, status: 'reserved' as const }]
    })
    vi.spyOn(orders, 'listOrders').mockResolvedValue({ date: 'x', ordering: { open: true }, orders: [] })
    const progress: number[] = []
    const dates = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
    const first = await loadDays('l', dates, { today: '2026-10-15', concurrency: 3, onProgress: (d) => progress.push(d) })
    expect(first.days.map((d) => d.date)).toEqual(dates)
    expect(first.days[0].reservations).toHaveLength(1)
    expect(first.failed).toBe(0)
    expect(peak).toBeLessThanOrEqual(3)
    expect(progress).toEqual([1, 2, 3, 4, 5, 6])
    expect(reservations).toHaveBeenCalledTimes(6)

    // Again a second later: the past days come from the cache, today too (within a minute).
    const second = await loadDays('l', dates, { today: '2026-10-15', now: () => Date.now() + 1000 })
    expect(second.days).toHaveLength(6)
    expect(reservations).toHaveBeenCalledTimes(6)

    // Two minutes later today is stale, the rest still fresh.
    await loadDays('l', dates, { today: '2026-10-15', now: () => Date.now() + 2 * 60_000 })
    expect(reservations).toHaveBeenCalledTimes(7)
  })

  it('counts a day as failed when a call breaks, and does not cache it', async () => {
    vi.spyOn(bookings, 'listReservations').mockRejectedValue(new Error('down'))
    vi.spyOn(orders, 'listOrders').mockResolvedValue({ date: 'x', ordering: { open: true }, orders: [] })
    const result = await loadDays('l', ['2026-10-10'], { today: '2026-10-15' })
    expect(result.failed).toBe(1)
    expect(result.days[0].reservations).toEqual([])
    await loadDays('l', ['2026-10-10'], { today: '2026-10-15' })
    expect(bookings.listReservations).toHaveBeenCalledTimes(2)
  })
})
