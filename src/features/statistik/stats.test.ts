import { describe, expect, it } from 'vitest'
import { addDays, datesIn, daysBetween, deltaPct, fmtKr, fmtPct, insightTitle, weekdayOf } from './stats'

describe('days', () => {
  it('adds days across months and counts them inclusively', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31)
    expect(datesIn('2026-10-30', '2026-11-01')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
    expect(weekdayOf('2026-10-19')).toBe(0)
    expect(weekdayOf('2026-10-25')).toBe(6)
  })
})

describe('text', () => {
  it('compares and words the change in Swedish', () => {
    expect(deltaPct(120, 100)).toBe(20)
    expect(deltaPct(100, 0)).toBeNull()
    expect(deltaPct(null, 5)).toBeNull()
    expect(insightTitle('Omsättningen', 12.4)).toBe('Omsättningen upp 12\u00a0%')
    expect(insightTitle('Omsättningen', -5.55)).toBe('Omsättningen ned 5,6\u00a0%')
    expect(insightTitle('Omsättningen', 0.2)).toBe('Omsättningen oförändrad')
    expect(insightTitle('Omsättningen', null)).toBe('Omsättningen')
  })

  it('formats money and percentages the Swedish way', () => {
    expect(fmtKr(940500).replace(/ /g, ' ')).toBe('9 405 kr')
    expect(fmtKr(null)).toBe('-')
    expect(fmtPct(33.333)).toBe('33\u00a0%')
    expect(fmtPct(2.5)).toBe('2,5\u00a0%')
    expect(fmtPct(0)).toBe('0\u00a0%')
  })
})
