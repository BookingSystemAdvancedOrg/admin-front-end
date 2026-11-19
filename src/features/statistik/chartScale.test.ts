import { describe, expect, it } from 'vitest'
import { axisTicks } from './chartScale'

describe('axisTicks', () => {
  it('keeps four equal steps when they are whole numbers or money', () => {
    expect(axisTicks(100, 'count')).toEqual([0, 25, 50, 75, 100])
    expect(axisTicks(5000, 'kr')).toEqual([0, 1250, 2500, 3750, 5000])
  })

  it('uses whole numbers for small counts', () => {
    expect(axisTicks(5, 'count')).toEqual([0, 1, 2, 3, 4, 5])
    expect(axisTicks(1, 'count')).toEqual([0, 1])
    expect(axisTicks(25, 'count')).toEqual([0, 5, 10, 15, 20, 25])
  })
})
