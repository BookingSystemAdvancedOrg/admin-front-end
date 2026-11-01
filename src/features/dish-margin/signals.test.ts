import { describe, expect, it } from 'vitest'
import { dishMarginSignals } from './signals'
import type { InsightsSummary } from '../statistik/insights'

describe('dishMarginSignals (Run 0 stub)', () => {
  it('adds no signals, so signals() is unchanged', () => {
    expect(dishMarginSignals({} as InsightsSummary)).toEqual([])
  })
})
