import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InsightsResponse } from '../statistik/insights'
import type { fetchInsights } from '../statistik/insightsApi'
import { KB } from './kb'
import { fillLive, NOT_YET, resolveLive, TOO_FAR } from './live'

describe('fillLive', () => {
  it('picks singular for 1 and plural otherwise', () => {
    const text = 'Idag har ni {value} {bokning|bokningar} och {gäst är|gäster är} här.'
    expect(fillLive(text, 1, '1')).toBe('Idag har ni 1 bokning och gäst är här.')
    expect(fillLive(text, 2, '2')).toBe('Idag har ni 2 bokningar och gäster är här.')
    expect(fillLive(text, 0, '0')).toBe('Idag har ni 0 bokningar och gäster är här.')
    expect(fillLive('{value} {beställning|beställningar}', 1200, '1 200')).toBe('1 200 beställningar')
  })
})

describe('resolveLive', () => {
  const summary = { bookings: 1, guests: 3 }
  const data = { money: false, current: summary } as unknown as InsightsResponse
  const ctx = (fetch: unknown) => ({ locationId: 'loc-1', timezone: 'Europe/Stockholm', isOwner: false, fetch: fetch as typeof fetchInsights })

  it('reads the range the server found for another day', async () => {
    const fetch = vi.fn().mockResolvedValue(data)
    const text = await resolveLive(
      { metric: 'bookings', text: 'Igår: {value} {bokning|bokningar}.', range: { from: '2026-11-13', to: '2026-11-13' } },
      ctx(fetch),
    )
    expect(text).toBe('Igår: 1 bokning.')
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-13', to: '2026-11-13', locationId: 'loc-1' }))
  })

  it('gives no number for a range metric without a sane range', async () => {
    const fetch = vi.fn().mockResolvedValue(data)
    expect(await resolveLive({ metric: 'bookings', text: '{value}' }, ctx(fetch))).toBeNull()
    expect(await resolveLive({ metric: 'bookings', text: '{value}', range: { from: '2026-11-20', to: '2026-11-15' } }, ctx(fetch))).toBeNull()
    expect(await resolveLive({ metric: 'bookings', text: '{value}', range: { from: '2026-01-01', to: '2026-12-31' } }, ctx(fetch))).toBeNull()
    expect(await resolveLive({ metric: 'bookings', text: '{value}', range: { from: 'x', to: 'y' } }, ctx(fetch))).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never gives staff an amount', async () => {
    const fetch = vi.fn().mockResolvedValue(data)
    expect(await resolveLive({ metric: 'revenue', text: '{value}', range: { from: '2026-11-13', to: '2026-11-13' } }, ctx(fetch))).toBeNull()
  })
})

describe('resolveLive for days after today', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T10:00:00Z')) // lördag
  })
  afterEach(() => vi.useRealTimers())

  const ctx = (fetch: unknown) => ({ locationId: 'loc-1', timezone: 'Europe/Stockholm', isOwner: true, fetch: fetch as typeof fetchInsights })
  // Som servern: current räknar bara till idag (tomt för morgondagen), upcoming dagarna efter idag.
  const reply = (current: object, upcoming: { date: string; bookings: number; guests: number }[]) =>
    ({ money: true, current: { bookings: 0, guests: 0, ...current }, upcoming }) as unknown as InsightsResponse

  it('counts tomorrow from the bookings still on, not 0', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({}, [{ date: '2026-11-15', bookings: 12, guests: 31 }]))
    const live = { metric: 'bookings', text: 'Imorgon: {value} {bokning|bokningar}.', range: { from: '2026-11-15', to: '2026-11-15' } }
    expect(await resolveLive(live, ctx(fetch))).toBe('Imorgon: 12 bokningar.')
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-15', to: '2026-11-15', ahead: 1 }))
    const guests = await resolveLive({ ...live, metric: 'guests', text: '{value} {gäst|gäster}' }, ctx(fetch))
    expect(guests).toBe('31 gäster')
  })

  it('adds today and the days ahead for a period that has started (i helgen on a Saturday)', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ bookings: 20 }, [{ date: '2026-11-15', bookings: 1, guests: 2 }]))
    const live = { metric: 'bookings', text: '{value} {bokning|bokningar}', range: { from: '2026-11-14', to: '2026-11-15' } }
    expect(await resolveLive(live, ctx(fetch))).toBe('21 bokningar')
  })

  it('counts only the days in the range from upcoming (på fredag)', async () => {
    const upcoming = Array.from({ length: 6 }, (_, i) => ({ date: `2026-11-${15 + i}`, bookings: i === 5 ? 1 : 9, guests: 2 }))
    const fetch = vi.fn().mockResolvedValue(reply({}, upcoming))
    const live = { metric: 'bookings', text: '{value} {bokning|bokningar}', range: { from: '2026-11-20', to: '2026-11-20' } }
    expect(await resolveLive(live, ctx(fetch))).toBe('1 bokning')
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ ahead: 6 }))
  })

  it('explains instead of 0 for what a future day cannot have yet, or too far ahead', async () => {
    const fetch = vi.fn()
    const range = { from: '2026-11-15', to: '2026-11-15' }
    for (const metric of ['orders', 'revenue', 'arrived', 'noShows', 'occupancy'])
      expect(await resolveLive({ metric, text: '{value}', range }, ctx(fetch))).toBe(NOT_YET)
    expect(await resolveLive({ metric: 'bookings', text: '{value}', range: { from: '2026-11-29', to: '2026-11-29' } }, ctx(fetch))).toBe(TOO_FAR)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gives no number when the server sends no upcoming (older API)', async () => {
    const fetch = vi.fn().mockResolvedValue(reply({}, []))
    expect(await resolveLive({ metric: 'bookings', text: '{value}', range: { from: '2026-11-15', to: '2026-11-15' } }, ctx(fetch))).toBeNull()
  })
})

describe('corpus texts', () => {
  it('prefer countText and keep text free of {one|many} for older apps', async () => {
    const fetch = vi.fn().mockResolvedValue({ money: false, current: { bookings: 1 } } as unknown as InsightsResponse)
    const live = { metric: 'bookingsToday', text: 'Idag har ni {value} bokningar.', countText: 'Idag har ni {value} {bokning|bokningar}.' }
    expect(await resolveLive(live, { locationId: 'loc-1', timezone: 'Europe/Stockholm', isOwner: false, fetch })).toBe('Idag har ni 1 bokning.')
    for (const entry of KB.entries) if (entry.live) expect(entry.live.text, entry.id).not.toMatch(/\{[^{}]*\|[^{}]*\}/)
  })
})
