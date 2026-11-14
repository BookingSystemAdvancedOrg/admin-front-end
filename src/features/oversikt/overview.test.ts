import { describe, expect, it } from 'vitest'
import { emptyBusinessHours } from '../installningar/locationApi'
import { hasAnyOpeningHours, phoneSetupStep, setupSteps, todaysHours, weekdayIn } from './overview'

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
      '11:00-14:00, 17:00-22:00',
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

describe('Telefonassistent in Kom igång', () => {
  const owner = { isOwner: true, hasOpeningHours: true, activeMenuItems: 3, hasLiveLayout: true, stripeStage: 'ready' as const, staffCount: 1 }
  const none = { namn: false, tider: false, nummer: false, koppla: false, prova: false }

  it('is a step only when the plan has the phone assistant', () => {
    expect(setupSteps(owner).some((s) => s.id === 'phone')).toBe(false)
    expect(setupSteps({ ...owner, phone: none }).at(-1)?.id).toBe('phone')
  })

  it('lists the five sub-steps and links to the next open one', () => {
    const step = phoneSetupStep({ ...none, namn: true, tider: true })
    expect(step.label).toBe('Telefonassistent')
    expect(step.done).toBe(false)
    expect(step.to).toBe('/telefon?flik=installningar&steg=nummer')
    expect(step.sub).toEqual([
      { label: 'Namn', done: true }, { label: 'Tider', done: true }, { label: 'Booqy-nummer', done: false },
      { label: 'Vidarekoppling', done: false }, { label: 'Provsamtal', done: false },
    ])
  })

  it('is done only when all five are done, and unknown when it could not be fetched', () => {
    expect(phoneSetupStep({ namn: true, tider: true, nummer: true, koppla: true, prova: false }).done).toBe(false)
    const all = phoneSetupStep({ namn: true, tider: true, nummer: true, koppla: true, prova: true })
    expect(all.done).toBe(true)
    expect(all.to).toBe('/telefon?flik=installningar')
    expect(phoneSetupStep(null).done).toBeNull()
    expect(setupSteps({ ...owner, phone: null }).at(-1)?.done).toBeNull()
  })
})

describe('Google-profil in Kom igång', () => {
  const owner = { isOwner: true, hasOpeningHours: true, activeMenuItems: 3, hasLiveLayout: true, stripeStage: 'ready' as const, staffCount: 1 }

  it('is a step only when the plan has Google, linking straight to the card, before the phone step', () => {
    expect(setupSteps(owner).some((s) => s.id === 'google')).toBe(false)
    const steps = setupSteps({ ...owner, google: false, phone: { namn: true, tider: true, nummer: true, koppla: true, prova: true } })
    const google = steps.find((s) => s.id === 'google')
    expect(google).toEqual({ id: 'google', label: 'Google-profil (valfritt)', done: false, to: '/installningar#google' })
    expect(steps.at(-1)?.id).toBe('phone')
  })

  it('is done when linked or skipped, and unknown when it could not be fetched', () => {
    expect(setupSteps({ ...owner, google: true }).find((s) => s.id === 'google')?.done).toBe(true)
    expect(setupSteps({ ...owner, google: null }).find((s) => s.id === 'google')?.done).toBeNull()
    expect(setupSteps({ ...owner, google: true }).every((s) => s.done === true)).toBe(true)
  })
})
