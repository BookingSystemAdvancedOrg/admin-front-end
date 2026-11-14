import { describe, expect, it } from 'vitest'
import type { BusinessHours } from '../installningar/locationApi'
import { dialSteps, encodeTel, firstOpen, forwardTarget, hasBusinessHours, hoursFor, hoursSet, hoursSummary, insideHours, progress } from './setup'

const weekdays = (opensAt: string, closesAt: string) => [{ opensAt, closesAt }]
const BH: BusinessHours = {
  monday: weekdays('11:00', '22:00'), tuesday: weekdays('11:00', '22:00'), wednesday: weekdays('11:00', '22:00'),
  thursday: weekdays('11:00', '22:00'), friday: weekdays('11:00', '22:00'), saturday: [], sunday: [],
}
const EMPTY: BusinessHours = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] }

describe('progress', () => {
  const loc = { mode: 'after_hours' as const, agentHours: {}, enabled: false, number: null, setup: { operator: null, forwardedAt: null, testedAt: null } }
  const nights = { mon: [{ from: '00:00', to: '11:00' }, { from: '22:00', to: '23:59' }] }
  it('counts nothing done for a new tenant and starts at the name', () => {
    const p = progress({ version: 0 }, loc)
    expect(p).toEqual({ namn: false, tider: false, nummer: false, koppla: false, prova: false })
    expect(firstOpen(p)).toBe('namn')
  })
  it('needs a number on an enabled location, then forwarding and the test call', () => {
    const p = progress({ version: 1 }, { ...loc, agentHours: nights, enabled: true, number: '+46100000001' })
    expect(firstOpen(p)).toBe('koppla')
    const all = progress({ version: 1 }, { ...loc, agentHours: nights, enabled: true, number: '+46100000001',
      setup: { operator: 'telia', forwardedAt: '2026-11-14T10:00:00Z', testedAt: '2026-11-14T10:05:00Z' } })
    expect(firstOpen(all)).toBeNull()
    expect(progress({ version: 1 }, { ...loc, agentHours: nights, enabled: false, number: '+46100000001' }).nummer).toBe(false)
  })
})

describe('hoursSet', () => {
  it('counts Tider done only with a span or in Alltid, never just because something was saved', () => {
    const base = { mode: 'after_hours' as const, agentHours: {} }
    expect(hoursSet(base)).toBe(false)
    expect(hoursSet({ ...base, agentHours: { mon: [] } })).toBe(false)
    expect(hoursSet({ ...base, agentHours: { sat: [{ from: '00:00', to: '23:59' }] } })).toBe(true)
    expect(hoursSet({ ...base, mode: 'always' })).toBe(true)
    // Steg 3 sparat utan steg 2 (version > 0, inga tider): Tider är inte klart.
    expect(progress({ version: 1 }, { ...base, enabled: true, number: '+46100000001', setup: undefined }).tider).toBe(false)
  })
})

describe('dialSteps and forwardTarget', () => {
  it('dials the reset first, then the codes, and forwards to the dev test line when there is one', () => {
    const forwarding = { number: '+358759899876', reset: [{ label: 'Av', on: '##002#' }], codes: [{ label: 'På', on: '**004*+358759899876#', off: '##004#' }] }
    expect(dialSteps({ forwarding }).map((c) => c.on)).toEqual(['##002#', '**004*+358759899876#'])
    expect(dialSteps({ forwarding: { ...forwarding, codes: [] } })).toEqual([])
    expect(forwardTarget({ forwarding, number: '+46100000001' })).toBe('+358759899876')
    expect(forwardTarget({ number: '+46100000001' })).toBe('+46100000001')
  })
})

describe('encodeTel', () => {
  it('encodes # as %23 and keeps * and +', () => {
    expect(encodeTel('**004*+46100000001#')).toBe('tel:**004*+46100000001%23')
    expect(encodeTel('##21#')).toBe('tel:%23%2321%23')
  })
})

describe('hoursFor', () => {
  it('after_hours is the gaps between the opening hours, closed days all day', () => {
    const h = hoursFor('after_hours', BH)
    expect(h.mon).toEqual([{ from: '00:00', to: '11:00' }, { from: '22:00', to: '23:59' }])
    expect(h.sat).toEqual([{ from: '00:00', to: '23:59' }])
    expect(h.sun).toEqual([{ from: '00:00', to: '23:59' }])
  })
  it('overflow is the opening hours, always has no hours', () => {
    expect(hoursFor('overflow', BH).mon).toEqual([{ from: '11:00', to: '22:00' }])
    expect(hoursFor('overflow', BH).sat).toEqual([])
    expect(hoursFor('always', BH)).toEqual({})
  })
  it('carries an overnight closing over to the next morning', () => {
    const night: BusinessHours = { ...EMPTY, friday: weekdays('18:00', '02:00') }
    const h = hoursFor('after_hours', night)
    expect(h.fri).toEqual([{ from: '00:00', to: '18:00' }])
    expect(h.sat).toEqual([{ from: '02:00', to: '23:59' }])
    expect(hoursFor('overflow', night).sat).toEqual([{ from: '00:00', to: '02:00' }])
    expect(hoursFor('overflow', night).fri).toEqual([{ from: '18:00', to: '23:59' }])
  })
  it('handles a lunch break and keeps at most three spans a day', () => {
    const lunch: BusinessHours = { ...EMPTY, monday: [{ opensAt: '11:00', closesAt: '14:00' }, { opensAt: '17:00', closesAt: '22:00' }] }
    expect(hoursFor('after_hours', lunch).mon).toEqual([{ from: '00:00', to: '11:00' }, { from: '14:00', to: '17:00' }, { from: '22:00', to: '23:59' }])
  })
  it('knows when there are no opening hours', () => {
    expect(hasBusinessHours(EMPTY)).toBe(false)
    expect(hasBusinessHours(null)).toBe(false)
    expect(hasBusinessHours(BH)).toBe(true)
    expect(hoursFor('after_hours', EMPTY)).toEqual({})
  })
})

describe('hoursSummary', () => {
  it('joins nights over midnight and groups days in a row', () => {
    expect(hoursSummary(hoursFor('after_hours', BH))).toBe('Mån-tor 22:00-11:00, fre 22:00-mån 11:00')
    expect(hoursSummary(hoursFor('overflow', BH))).toBe('Mån-fre 11:00-22:00')
  })
  it('says whole days and the whole week', () => {
    expect(hoursSummary({ sat: [{ from: '00:00', to: '23:59' }], sun: [{ from: '00:00', to: '23:59' }] })).toBe('Lör-sön hela dagen')
    expect(hoursSummary(hoursFor('after_hours', EMPTY))).toBe('')
    const all = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ from: '00:00', to: '23:59' }]]))
    expect(hoursSummary(all)).toBe('Hela veckan')
  })
  it('never uses an en or em dash', () => {
    expect(hoursSummary(hoursFor('after_hours', BH))).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('insideHours', () => {
  it('reads the hours in Stockholm time', () => {
    const h = hoursFor('after_hours', BH)
    expect(insideHours(h, new Date('2026-11-16T22:30:00Z'))).toBe(true)   // Monday 23:30 in Stockholm
    expect(insideHours(h, new Date('2026-11-16T12:00:00Z'))).toBe(false)  // Monday 13:00, open
  })
  it('covers the minute 23:59 when a span ends at 23:59', () => {
    const h = hoursFor('after_hours', BH)
    expect(h.mon?.at(-1)).toEqual({ from: '22:00', to: '23:59' })
    expect(insideHours(h, new Date('2026-11-16T22:59:30Z'))).toBe(true)   // Monday 23:59:30 in Stockholm
    expect(insideHours({ mon: [{ from: '22:00', to: '23:30' }] }, new Date('2026-11-16T22:45:00Z'))).toBe(false)
  })
})
