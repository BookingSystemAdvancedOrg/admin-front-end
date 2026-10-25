import { describe, expect, it } from 'vitest'
import { parseKronor, rangesOverlap, settingsProblem } from './data'
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
