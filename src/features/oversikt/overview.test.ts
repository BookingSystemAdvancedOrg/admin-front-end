import { describe, expect, it } from 'vitest'
import { emptyBusinessHours } from '../installningar/locationApi'
import { hasAnyOpeningHours, stepsFromServer, todaysHours, weekdayIn } from './overview'
import { PHONE_SUB, serverChecklist } from './setupFixture'

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

describe('stepsFromServer', () => {
  it('shows the server steps for the chosen location, in its order and with its labels', () => {
    const steps = stepsFromServer(serverChecklist({ dpa: 'done', hours: 'done' }), 'loc-1')
    expect(steps.map((s) => s.id)).toEqual(['dpa', 'hours', 'menu', 'printers', 'layout', 'stripe', 'staff', 'google', 'phone'])
    expect(steps[0]).toMatchObject({ label: 'Godkänn personuppgiftsbiträdesavtalet', done: true, state: 'done', to: '/avtal', skippable: false })
    expect(steps[2]).toMatchObject({ id: 'menu', done: false, state: 'open', to: '/meny', locationId: 'loc-1', skippable: true })
    expect(steps[5].locationId).toBeUndefined()
  })

  it('counts skipped as finished and says how it was skipped', () => {
    const steps = stepsFromServer(serverChecklist({ stripe: 'skipped', printers: 'skipped', google: 'skipped' }, { skippedHere: ['stripe'] }), 'loc-1')
    const by = Object.fromEntries(steps.map((s) => [s.id, s]))
    expect(by.stripe).toMatchObject({ done: true, state: 'skipped', skippedHere: true, later: 'Överhoppat' })
    expect(by.printers).toMatchObject({ done: true, skippedHere: false, later: 'Inga skrivare än' })
    expect(by.google.later).toBe('Ingen Google-profil')
  })

  it('a step the server could not check is unknown, not done', () => {
    const step = stepsFromServer(serverChecklist({}, { unknown: ['menu'] }), 'loc-1').find((s) => s.id === 'menu')!
    expect(step.done).toBeNull()
    expect(step.state).toBeNull()
  })

  it('a location the server has not seen yet is open', () => {
    const step = stepsFromServer(serverChecklist({ hours: 'done' }), 'loc-new').find((s) => s.id === 'hours')!
    expect(step.done).toBeNull()
  })

  it('links the phone step to its first open sub-step and labels the sub-steps', () => {
    const list = serverChecklist()
    const phone = list.steps.find((s) => s.id === 'phone')!
    phone.locations![0].sub = PHONE_SUB.map((id, i) => ({ id, done: i < 2 }))
    const step = stepsFromServer(list, 'loc-1').find((s) => s.id === 'phone')!
    expect(step.to).toBe('/telefon?flik=installningar&steg=nummer')
    expect(step.sub?.map((x) => x.label)).toEqual(['Namn', 'Tider', 'Booqy-nummer', 'Vidarekoppling', 'Provsamtal'])
  })

  it('shows a step admin does not know yet with the server label', () => {
    const list = serverChecklist({})
    list.steps.push({ id: 'logo', label: 'Ladda upp logga', labelEn: 'Logo', scope: 'tenant', skippable: true, state: 'open', known: true })
    const step = stepsFromServer(list, 'loc-1').at(-1)!
    expect(step).toMatchObject({ label: 'Ladda upp logga', to: '/', done: false })
  })

  it('nothing without a list', () => {
    expect(stepsFromServer(null, 'loc-1')).toEqual([])
  })
})
