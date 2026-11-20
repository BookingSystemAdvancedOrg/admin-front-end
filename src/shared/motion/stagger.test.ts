import { describe, expect, it } from 'vitest'
import { spreadIndex, STAGGER_CAP, staggerIndex, staggerStyle } from './stagger'

describe('stagger', () => {
  it('counts up to the cap, then the rest share the last step', () => {
    expect([0, 1, 6, 7, 8, 40].map((i) => staggerIndex(i))).toEqual([0, 1, 6, 7, 7, 7])
    expect(staggerStyle(12)).toEqual({ '--i': STAGGER_CAP })
  })

  it('never goes below zero', () => {
    expect(staggerIndex(-3)).toBe(0)
  })

  it('spreads a long series evenly over the same steps', () => {
    expect(spreadIndex(0, 30)).toBe(0)
    expect(spreadIndex(29, 30)).toBe(STAGGER_CAP)
    expect(spreadIndex(15, 30)).toBeGreaterThan(spreadIndex(14, 30))
    // a short series is a plain stagger
    expect(spreadIndex(3, 5)).toBe(3)
  })
})
