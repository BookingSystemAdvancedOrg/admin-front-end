import { describe, expect, it } from 'vitest'
import { emptyBusinessHours } from '../installningar/locationApi'
import { hasAnyOpeningHours, setupSteps, todaysHours, weekdayIn } from './overview'

// Fredag 9 okt 2026 23:30 UTC = lördag 01:30 i Stockholm.
const FRIDAY_NIGHT_UTC = new Date('2026-10-09T23:30:00Z')

describe('weekdayIn', () => {
  it("uses the location's time zone, not the browser's", () => {
    expect(weekdayIn('Europe/Stockholm', FRIDAY_NIGHT_UTC)).toBe('saturday')
    expect(weekdayIn('America/New_York', FRIDAY_NIGHT_UTC)).toBe('friday')
  })

  it('falls back to Stockholm for an invalid or missing time zone', () => {
    expect(weekdayIn('Not/AZone', FRIDAY_NIGHT_UTC)).toBe('saturday')
    expect(weekdayIn(null, FRIDAY_NIGHT_UTC)).toBe('saturday')
  })
})

describe('todaysHours', () => {
  it('lists today\'s intervals', () => {
    const hours = {
      ...emptyBusinessHours(),
      saturday: [
        { opensAt: '11:00', closesAt: '14:00' },
        { opensAt: '17:00', closesAt: '22:00' },
      ],
    }
    expect(todaysHours(hours, 'Europe/Stockholm', FRIDAY_NIGHT_UTC)).toBe(
      '11:00–14:00, 17:00–22:00',
    )
  })

  it('says closed when there are no intervals (new locations start closed)', () => {
    expect(todaysHours(emptyBusinessHours(), 'Europe/Stockholm', FRIDAY_NIGHT_UTC)).toBe(
      'Stängt',
    )
    expect(todaysHours(undefined, null, FRIDAY_NIGHT_UTC)).toBe('Stängt')
  })
})

describe('hasAnyOpeningHours', () => {
  it('is false for a brand-new location', () => {
    expect(hasAnyOpeningHours(emptyBusinessHours())).toBe(false)
  })

  it('is true once any day has hours', () => {
    expect(
      hasAnyOpeningHours({
        ...emptyBusinessHours(),
        monday: [{ opensAt: '10:00', closesAt: '12:00' }],
      }),
    ).toBe(true)
  })
})

describe('setupSteps', () => {
  const owner = {
    isOwner: true,
    hasOpeningHours: false,
    activeMenuItems: 0,
    hasLiveLayout: false,
    stripeStage: 'not_started' as const,
    staffCount: 0,
  }

  it('gives a new owner every step to do', () => {
    const steps = setupSteps(owner)
    expect(steps.map((s) => s.id)).toEqual(['hours', 'menu', 'layout', 'stripe', 'staff'])
    expect(steps.every((s) => s.done === false)).toBe(true)
  })

  it('marks finished steps as done', () => {
    const steps = setupSteps({
      ...owner,
      hasOpeningHours: true,
      activeMenuItems: 12,
      hasLiveLayout: true,
      stripeStage: 'ready',
      staffCount: 2,
    })
    expect(steps.every((s) => s.done === true)).toBe(true)
  })

  it('keeps unknown data unknown instead of claiming done or not done', () => {
    const steps = setupSteps({ ...owner, activeMenuItems: null, staffCount: null })
    expect(steps.find((s) => s.id === 'menu')?.done).toBeNull()
    expect(steps.find((s) => s.id === 'staff')?.done).toBeNull()
  })

  it('gives staff no Kom igång steps at all (owner only)', () => {
    expect(setupSteps({ ...owner, isOwner: false })).toEqual([])
  })

  it('puts the DPA first when the API has it, and leaves it out otherwise', () => {
    expect(setupSteps({ ...owner, dpaAccepted: false })[0]).toEqual({
      id: 'dpa', label: 'Godkänn personuppgiftsbiträdesavtalet', done: false, to: '/avtal',
    })
    expect(setupSteps({ ...owner, dpaAccepted: true })[0].done).toBe(true)
    expect(setupSteps({ ...owner, isOwner: false, dpaAccepted: false })).toEqual([])
  })
})
