import { describe, expect, it } from 'vitest'
import { minutesLabel, newWindow, overlapWarnings, rulesFromLocation, toPayload, validateRules } from './bookingTime'
import type { BookingTimeRules, BookingTimeWindow } from './bookingTime'

function rules(...windows: Partial<BookingTimeWindow>[]): BookingTimeRules {
  return {
    defaultMinutes: 90,
    extension: { allowed: true, maxMinutes: 30 },
    lastSeatingMinutes: 120,
    windows: windows.map((w, i) => ({ ...newWindow(), id: `w${i}`, ...w })),
  }
}

describe('bookingTime', () => {
  it('labels minutes the Swedish way', () => {
    expect(minutesLabel(45)).toBe('45 min')
    expect(minutesLabel(60)).toBe('1 tim')
    expect(minutesLabel(90)).toBe('1 tim 30 min')
  })

  it('starts an older location from its own length without extension', () => {
    expect(rulesFromLocation(undefined, 2)).toEqual({
      defaultMinutes: 120,
      extension: { allowed: false, maxMinutes: 0 },
      lastSeatingMinutes: 120,
      windows: [],
    })
  })

  it('accepts the customer rules: 90 min extendable, buffet 60 min not', () => {
    expect(validateRules(rules({ name: 'Lunchbuffé' }), 15)).toBeNull()
  })

  it.each([
    [rules({ name: ' ' }), 'namn'],
    [rules({ weekdays: [] }), 'veckodag'],
    [rules({ startTime: '22:00', endTime: '01:00' }), 'midnatt'],
    [rules({ startTime: '11:10' }), 'kvartssteg'],
    [rules({ dateFrom: '2026-12-01', dateTo: '2026-11-01' }), 'från-datumet'],
    [rules({ extension: { allowed: true, maxMinutes: 20 } }), 'förlängning'],
    [rules({ name: 'A' }, { name: 'B', startTime: '13:00', endTime: '15:00' }), 'samma prioritet'],
    [rules({ durationMinutes: 15 }), 'Grace period'],
  ])('refuses invalid rules (%#)', (value, message) => {
    expect(validateRules(value, 15)).toContain(message)
  })

  it('warns about overlaps that resolve, naming the winner', () => {
    const value = rules({ name: 'Lunch' }, { name: 'Brunch', startTime: '13:00', endTime: '15:00', priority: 2 })
    expect(validateRules(value, 15)).toBeNull()
    expect(overlapWarnings(value)).toEqual(['Lunch och Brunch överlappar - Brunch gäller där (högre prioritet).'])
    const dated = rules({ name: 'Lunch' }, { name: 'Jul', dateFrom: '2026-12-01' })
    expect(overlapWarnings(dated)[0]).toContain('Jul gäller där (har datum)')
    expect(overlapWarnings(rules({ name: 'Lunch' }, { name: 'Middag', startTime: '14:00', endTime: '17:00' }))).toEqual([])
  })

  it('sends clean values', () => {
    const value = rules({ name: '  Lunch   buffé ', weekdays: ['friday', 'monday'], dateFrom: '', extension: { allowed: false, maxMinutes: 30 } })
    const [w] = toPayload(value).windows
    expect(w.name).toBe('Lunch buffé')
    expect(w.weekdays).toEqual(['monday', 'friday'])
    expect('dateFrom' in w).toBe(false)
    expect(w.extension).toEqual({ allowed: false, maxMinutes: 0 })
  })
})
