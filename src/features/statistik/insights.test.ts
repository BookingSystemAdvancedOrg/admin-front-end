import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeFilterCount, filtersFrom, filtersToParams, presetRange, signals, toCsv } from './insights'
import type { Filters, InsightsSummary } from './insights'
import { sampleInsights, sampleSummary } from './insightsSample'

const TODAY = '2026-10-22' // en torsdag

function filters(extra: Partial<Filters> = {}): Filters {
  return { preset: 'd30', ...presetRange('d30', TODAY), locationId: 'loc-1', service: 'all', channel: 'all', compare: 'previous', ...extra }
}

describe('periods', () => {
  it('presets end today and start where they should', () => {
    expect(presetRange('today', TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(presetRange('week', TODAY)).toEqual({ from: '2026-10-19', to: TODAY })
    expect(presetRange('month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(presetRange('lastMonth', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('quarter', TODAY)).toEqual({ from: '2026-10-01', to: TODAY })
    expect(presetRange('year', TODAY)).toEqual({ from: '2026-01-01', to: TODAY })
  })
})

describe('filters in the address', () => {
  it('reads defaults and unknown values as the standard choice', () => {
    const f = filtersFrom(new URLSearchParams('period=nonsense&service=brunch'), TODAY, 'all')
    expect(f).toMatchObject({ preset: 'd30', service: 'all', channel: 'all', compare: 'previous', locationId: 'all' })
  })

  it('keeps a custom range, cuts it at today and at two years', () => {
    const f = filtersFrom(new URLSearchParams('period=custom&from=2026-09-01&to=2026-12-01'), TODAY, 'all')
    expect([f.from, f.to]).toEqual(['2026-09-01', TODAY])
    const long = filtersFrom(new URLSearchParams('period=custom&from=2020-01-01&to=2026-10-22'), TODAY, 'all')
    expect(long.from).toBe('2024-10-22')
    const broken = filtersFrom(new URLSearchParams('period=custom&from=2026-10-10&to=2026-10-01'), TODAY, 'all')
    expect(broken.preset).toBe('custom')
    expect(broken.to).toBe(TODAY)
  })

  it('round-trips and leaves defaults out', () => {
    const f = filters({ preset: 'custom', from: '2026-10-01', to: '2026-10-10', service: 'lunch', compare: 'year' })
    const p = filtersToParams(f, 'loc-1')
    expect(p.toString()).toBe('period=custom&from=2026-10-01&to=2026-10-10&service=lunch&compare=year')
    expect(filtersFrom(p, TODAY, 'loc-1')).toEqual(f)
    expect(activeFilterCount(f, 'loc-1')).toBe(2)
  })
})

function summary(extra: Partial<InsightsSummary> = {}): InsightsSummary {
  return { ...sampleSummary('2026-10-01', '2026-10-21', TODAY, { service: 'all', channel: 'all' }), ...extra }
}

describe('Att göra', () => {
  it('names a high no-show rate first and links to the guarantee settings', () => {
    const out = signals(summary({ bookings: 200, noShowPct: 12, noShows: 24, heat: [] }), null)
    expect(out[0]).toMatchObject({ id: 'noshow', to: '/installningar' })
    expect(out[0].title).toContain('12')
    expect(out.length).toBeLessThanOrEqual(3)
  })

  it('finds the emptiest pass and suggests a mailing when marketing is on', () => {
    const heat = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) =>
      [11, 12, 18, 19].map((hour) => ({ weekday, hour, occupancy: weekday === 1 && hour < 15 ? 10 : 60 })),
    )
    const out = signals(summary({ bookings: 200, noShowPct: 1, lateCancelPct: 1, heat }), null, { marketing: true })
    const low = out.find((s) => s.id === 'lowpass')
    expect(low?.title).toBe('Tomt på tisdagar till lunch')
    expect(low?.to).toBe('/marknadsforing')
  })

  it('stays quiet without enough data', () => {
    expect(signals(summary({ bookings: 3, noShowPct: 50, orders: 2, sources: { online: 1, phone: 2, onsite: 0 }, web: { ...summary().web, channels: [] }, catering: { ...summary().catering, offers: 0 } }), null)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: 'noshow' })]),
    )
  })

  it('flags a top dish that sells much less than before', () => {
    const s = summary({ dishes: [{ id: 'a', name: 'Pizza', quantity: 20, previousQuantity: 60 }] })
    const out = signals(s, summary())
    expect(out.some((x) => x.id === 'dish' && x.title.startsWith('Pizza säljer'))).toBe(true)
  })
})

describe('CSV', () => {
  it('writes one row per day with Swedish separators, amounts only for the owner', () => {
    const owner = toCsv(sampleInsights(filters({ preset: 'custom', from: '2026-10-19', to: '2026-10-20' }), TODAY, true))
    const lines = owner.replace('﻿', '').trim().split('\r\n')
    expect(lines[0]).toBe('Datum;Bokningar;Gäster;Uteblivna;Avbokade;Beläggning %;Beställningar;Beställningar kr;Catering kr;Omsättning kr;Besök')
    expect(lines).toHaveLength(3)
    expect(lines[1].startsWith('2026-10-19;')).toBe(true)
    const staff = toCsv(sampleInsights(filters({ preset: 'custom', from: '2026-10-19', to: '2026-10-20' }), TODAY, false))
    expect(staff).not.toContain(' kr')
  })
})

describe('sample', () => {
  it('is the same every time and follows the filters', () => {
    const a = sampleInsights(filters(), TODAY, true)
    const b = sampleInsights(filters(), TODAY, true)
    expect(a).toEqual(b)
    const lunch = sampleInsights(filters({ service: 'lunch' }), TODAY, true).current
    expect(lunch.bookings).toBeLessThan(a.current.bookings)
    expect(lunch.byHour.every((h) => h.hour < 15)).toBe(true)
    const phone = sampleInsights(filters({ channel: 'phone' }), TODAY, true).current
    expect(phone.sources.online).toBe(0)
  })

  it('leaves every amount out for staff', () => {
    const r = sampleInsights(filters(), TODAY, false)
    expect(r.money).toBe(false)
    expect(r.current.revenue).toBeUndefined()
    expect(r.current.dishes[0].revenue).toBeUndefined()
    expect(r.current.byDay[0].revenue).toBeUndefined()
  })
})

describe('insightsApi', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('asks once per filter set within a minute', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ current: {} })
    vi.doMock('../../shared/api', () => ({ apiFetch }))
    const { fetchInsights } = await import('./insightsApi')
    let t = 0
    const now = () => t
    await fetchInsights(filters(), now)
    await fetchInsights(filters(), now)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch.mock.calls[0][0]).toBe(
      '/insights?from=2026-09-23&to=2026-10-22&locationId=loc-1&service=all&channel=all&compare=previous',
    )
    t = 61_000
    await fetchInsights(filters(), now)
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})
