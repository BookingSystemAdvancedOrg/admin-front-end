import { describe, expect, it, vi } from 'vitest'
import type { InsightsResponse } from '../statistik/insights'
import type { fetchInsights } from '../statistik/insightsApi'
import { fillLive, resolveLive } from './live'

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
      { metric: 'bookings', text: 'Imorgon: {value} {bokning|bokningar}.', range: { from: '2026-11-15', to: '2026-11-15' } },
      ctx(fetch),
    )
    expect(text).toBe('Imorgon: 1 bokning.')
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-11-15', to: '2026-11-15', locationId: 'loc-1' }))
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
    expect(await resolveLive({ metric: 'revenue', text: '{value}', range: { from: '2026-11-15', to: '2026-11-15' } }, ctx(fetch))).toBeNull()
  })
})
