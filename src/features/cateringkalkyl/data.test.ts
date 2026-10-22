import { describe, expect, it } from 'vitest'
import { nextTierAfter, parseKronor, rangesOverlap, settingsProblem, tierFor } from './data'
import type { DiscountTier } from './data'

const tiers: DiscountTier[] = [
  { id: 'bas', name: 'Bas', fromPortions: 10, toPortions: 29, discountPercent: 0, active: true },
  { id: 'niva-1', name: 'Nivå 1', fromPortions: 30, toPortions: 59, discountPercent: 5, active: true },
  { id: 'niva-2', name: 'Nivå 2', fromPortions: 60, toPortions: 99, discountPercent: 10, active: true },
  { id: 'niva-3', name: 'Nivå 3', fromPortions: 100, toPortions: null, discountPercent: 15, active: true },
]

describe('tierFor', () => {
  it('finds the tier whose range covers the total', () => {
    expect(tierFor(tiers, 60)?.id).toBe('niva-2')
    expect(tierFor(tiers, 99)?.id).toBe('niva-2')
    expect(tierFor(tiers, 29)?.id).toBe('bas')
  })

  it('treats a null upper bound as unbounded', () => {
    expect(tierFor(tiers, 100)?.id).toBe('niva-3')
    expect(tierFor(tiers, 100000)?.id).toBe('niva-3')
  })

  it('returns null below every tier and skips inactive tiers', () => {
    expect(tierFor(tiers, 5)).toBeNull()
    const withInactive = tiers.map((t) => (t.id === 'niva-2' ? { ...t, active: false } : t))
    expect(tierFor(withInactive, 60)).toBeNull()
  })
})

describe('nextTierAfter', () => {
  it('returns the next-highest active tier by fromPortions', () => {
    expect(nextTierAfter(tiers, tiers[1])?.id).toBe('niva-2')
  })

  it('returns the lowest tier when nothing currently applies', () => {
    expect(nextTierAfter(tiers, null)?.id).toBe('bas')
  })

  it('returns null once already on the highest tier', () => {
    expect(nextTierAfter(tiers, tiers[3])).toBeNull()
  })

  it('skips an inactive tier when picking the next one', () => {
    const withInactive = tiers.map((t) => (t.id === 'niva-2' ? { ...t, active: false } : t))
    expect(nextTierAfter(withInactive, tiers[1])?.id).toBe('niva-3')
  })
})

describe('rangesOverlap', () => {
  it('detects a genuine overlap', () => {
    expect(rangesOverlap(30, 59, 50, 70)).toBe(true)
  })

  it('treats adjacent, non-overlapping ranges as fine', () => {
    expect(rangesOverlap(10, 29, 30, 59)).toBe(false)
  })

  it('treats a null upper bound as reaching to infinity', () => {
    expect(rangesOverlap(100, null, 150, 200)).toBe(true)
    expect(rangesOverlap(100, null, 50, 99)).toBe(false)
  })
})

describe('settingsProblem', () => {
  const base = { deliveryBands: [{ upToKm: 10, price: 200 }, { upToKm: 25, price: 400 }], leadTimeRules: [],
    minGuests: 15, requestExpiryHours: 72, ownerReminderHours: 24, offerValidDays: 7, signReminderDaysBefore: 2 }
  it('accepts valid settings', () => expect(settingsProblem(base)).toBeNull())
  it('rejects bands out of order', () =>
    expect(settingsProblem({ ...base, deliveryBands: [{ upToKm: 20, price: 1 }, { upToKm: 20, price: 2 }] })).toMatch(/stigande/))
  it('rejects gaps and overlaps in lead time', () => {
    const gap = [{ fromGuests: 15, toGuests: 40, days: 3 }, { fromGuests: 50, toGuests: null, days: 7 }]
    const open = [{ fromGuests: 15, toGuests: null, days: 3 }, { fromGuests: 50, toGuests: null, days: 7 }]
    expect(settingsProblem({ ...base, leadTimeRules: gap })).toMatch(/luckor/)
    expect(settingsProblem({ ...base, leadTimeRules: open })).toMatch(/luckor/)
    const ok = [{ fromGuests: 41, toGuests: null, days: 7 }, { fromGuests: 15, toGuests: 40, days: 3 }]
    expect(settingsProblem({ ...base, leadTimeRules: ok })).toBeNull()
  })
  it('rejects reminders after the expiry', () =>
    expect(settingsProblem({ ...base, ownerReminderHours: 72 })).toMatch(/innan/))
})

describe('parseKronor', () => {
  it('reads kronor', () => {
    expect(parseKronor('145,50')).toBe(145.5)
    expect(parseKronor('120 kr')).toBe(120)
    expect(parseKronor('1.234')).toBeNull()
    expect(parseKronor('-5')).toBeNull()
    expect(parseKronor('20000')).toBeNull()
  })
})
