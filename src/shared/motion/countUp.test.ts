import { describe, expect, it } from 'vitest'
import { easeOutCubic, easeOutExpo, formatStatValue, parseStatValue } from './countUp'

describe('parseStatValue', () => {
  it('reads a plain count', () => {
    expect(parseStatValue('4')).toEqual({ prefix: '', value: 4, decimals: 0, suffix: '' })
  })

  it('reads kronor with thousands and decimals', () => {
    expect(parseStatValue('1 250 kr')).toEqual({ prefix: '', value: 1250, decimals: 0, suffix: ' kr' })
    expect(parseStatValue('12,50 kr')).toEqual({ prefix: '', value: 12.5, decimals: 2, suffix: ' kr' })
  })

  it('gives null for text without a number', () => {
    expect(parseStatValue('-')).toBeNull()
    expect(parseStatValue('…')).toBeNull()
  })
})

describe('formatStatValue', () => {
  it('lands on exactly the original string', () => {
    for (const text of ['4', '0', '1 250 kr', '12,50 kr', '1 234 567 kr']) {
      const n = parseStatValue(text)!
      expect(formatStatValue(n, n.value)).toBe(text)
    }
  })

  it('formats intermediate values the same way', () => {
    const n = parseStatValue('1 250 kr')!
    expect(formatStatValue(n, 999.6)).toBe('1 000 kr')
    expect(formatStatValue(parseStatValue('12,50 kr')!, 3.456)).toBe('3,46 kr')
  })
})

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1 and clamps', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875)
  })
})

describe('easeOutExpo', () => {
  it('starts fast and lands exactly on 1', () => {
    expect(easeOutExpo(0)).toBe(0)
    expect(easeOutExpo(0.1)).toBeCloseTo(0.5, 2)
    expect(easeOutExpo(0.5)).toBeGreaterThan(0.96)
    expect(easeOutExpo(1)).toBe(1)
    expect(easeOutExpo(2)).toBe(1)
  })
})
