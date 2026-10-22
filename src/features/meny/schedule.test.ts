import { describe, expect, it } from 'vitest'
import {
  dishStatus,
  dishStatusLabel,
  matchesStatus,
  utcToZonedInput,
  zonedInputToUtc,
} from './schedule'

const TZ = 'Europe/Stockholm'

describe('zonedInputToUtc', () => {
  it('converts winter and summer time', () => {
    expect(zonedInputToUtc('2026-01-15T11:00', TZ)).toBe('2026-01-15T10:00:00Z')
    expect(zonedInputToUtc('2026-07-01T11:00', TZ)).toBe('2026-07-01T09:00:00Z')
  })

  it('rejects the spring gap on 2026-03-29', () => {
    expect(zonedInputToUtc('2026-03-29T01:59', TZ)).toBe('2026-03-29T00:59:00Z')
    expect(zonedInputToUtc('2026-03-29T02:00', TZ)).toBeNull()
    expect(zonedInputToUtc('2026-03-29T02:30', TZ)).toBeNull()
    expect(zonedInputToUtc('2026-03-29T03:00', TZ)).toBe('2026-03-29T01:00:00Z')
  })

  it('takes the earlier instant in the autumn fold on 2026-10-25', () => {
    expect(zonedInputToUtc('2026-10-25T02:30', TZ)).toBe('2026-10-25T00:30:00Z')
    expect(zonedInputToUtc('2026-10-25T03:00', TZ)).toBe('2026-10-25T02:00:00Z')
  })

  it('rejects malformed input', () => {
    expect(zonedInputToUtc('', TZ)).toBeNull()
    expect(zonedInputToUtc('2026-10-25 02:30', TZ)).toBeNull()
  })
})

describe('utcToZonedInput', () => {
  it('round trips outside the DST switches', () => {
    for (const v of ['2026-01-15T11:00', '2026-07-01T23:59', '2026-12-31T00:00']) {
      expect(utcToZonedInput(zonedInputToUtc(v, TZ), TZ)).toBe(v)
    }
  })

  it('shows both fold instants as the same wall time', () => {
    expect(utcToZonedInput('2026-10-25T00:30:00Z', TZ)).toBe('2026-10-25T02:30')
    expect(utcToZonedInput('2026-10-25T01:30:00Z', TZ)).toBe('2026-10-25T02:30')
  })

  it('is empty for no bound', () => {
    expect(utcToZonedInput(null, TZ)).toBe('')
  })
})

describe('dishStatus', () => {
  const at = (iso: string) => new Date(iso)
  const dish = { active: true, availableFrom: '2026-11-01T10:00:00Z', availableUntil: '2026-11-01T13:00:00Z' }

  it('uses an inclusive start and an exclusive end', () => {
    expect(dishStatus(dish, at('2026-11-01T09:59:59Z'))).toBe('scheduled')
    expect(dishStatus(dish, at('2026-11-01T10:00:00Z'))).toBe('active')
    expect(dishStatus(dish, at('2026-11-01T12:59:59Z'))).toBe('active')
    expect(dishStatus(dish, at('2026-11-01T13:00:00Z'))).toBe('expired')
  })

  it('lets the toggle win and treats null as no bound', () => {
    expect(dishStatus({ ...dish, active: false }, at('2026-11-01T11:00:00Z'))).toBe('off')
    expect(dishStatus({ active: true, availableFrom: null, availableUntil: null }, at('2030-01-01T00:00:00Z'))).toBe('active')
  })

  it('labels in the location time zone', () => {
    expect(dishStatusLabel(dish, at('2026-11-01T09:00:00Z'), TZ)).toBe('Schemalagd (startar 1 nov. 11:00)')
    expect(dishStatusLabel(dish, at('2026-11-01T14:00:00Z'), TZ)).toBe('Utgången (slutade 1 nov. 14:00)')
    expect(dishStatusLabel({ ...dish, active: false }, at('2026-11-01T11:00:00Z'), TZ)).toBe('Av')
  })
})

describe('matchesStatus', () => {
  it('keeps the old active/inactive result for dishes without a schedule', () => {
    expect(matchesStatus('active', 'active')).toBe(true)
    expect(matchesStatus('active', 'off')).toBe(false)
    expect(matchesStatus('inactive', 'off')).toBe(true)
    expect(matchesStatus('inactive', 'active')).toBe(false)
  })

  it('filters scheduled and expired dishes', () => {
    expect(matchesStatus('scheduled', 'scheduled')).toBe(true)
    expect(matchesStatus('expired', 'expired')).toBe(true)
    expect(matchesStatus('active', 'expired')).toBe(false)
    expect(matchesStatus('inactive', 'expired')).toBe(false)
    expect(matchesStatus('alla', 'expired')).toBe(true)
  })
})
