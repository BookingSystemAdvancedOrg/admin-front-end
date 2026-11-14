import { describe, expect, it } from 'vitest'
import cases from './helpDateCases.json'
import { parseWhen, todayIn } from './dates'
import { liveFor } from './retrieve'

/** Samma exempel som servern (application/tests/help_dates_cases.json, npm run help-kb:sync). */
type Case = { today: string; question: string; expect: { from: string; to: string; label: string } | null }

describe('days in help questions', () => {
  it.each(cases as Case[])('$today: $question', (c) => {
    const got = parseWhen(c.question, c.today)
    expect(got && { from: got.from, to: got.to, label: got.label }).toEqual(c.expect)
  })

  it('looks the day up as today', () => {
    expect(parseWhen('Hur många gäster har vi i helgen?', '2026-11-14')?.query).toBe('hur manga gaster har vi idag')
    expect(parseWhen('Bokningar 20/11?', '2026-11-14')?.query).toBe('bokningar idag')
  })

  it('counts today in Stockholm', () => {
    // 23:30 UTC den 14 november är redan den 15 i Stockholm.
    expect(todayIn(undefined, new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15')
  })
})

describe('liveFor', () => {
  const live = { metric: 'bookingsToday', text: 'Idag {value}', rangeText: '{period}: {value} {bokning|bokningar}.' }

  it('gives another day its range and the metric without period', () => {
    expect(liveFor(live, 'Hur många bokningar har vi imorgon?', '2026-11-14')).toEqual({
      metric: 'bookings',
      text: 'Imorgon, söndag 15 november: {value} {bokning|bokningar}.',
      range: { from: '2026-11-15', to: '2026-11-15' },
    })
  })

  it('keeps today as it is, and never shows today for another day', () => {
    expect(liveFor(live, 'Hur många bokningar har vi idag?', '2026-11-14')).toBe(live)
    expect(liveFor({ metric: 'bookingsToday', text: 'Idag {value}' }, 'imorgon', '2026-11-14')).toBeNull()
  })
})
