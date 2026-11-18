import { describe, expect, it } from 'vitest'
import type { LayoutElement, PublishedLayoutSnapshot } from './layoutApi'
import { countsOf, daysUntil, shortDate, sizeText, versionTimeline } from './versionTimeline'

const NOW = new Date('2026-11-18T11:00:00Z')
const table = (seats?: number) => ({ type: 'table', seats }) as LayoutElement
const snap = (n: number, o: Partial<PublishedLayoutSnapshot> = {}): PublishedLayoutSnapshot => ({
  version: n, label: `Version ${n}`, isCurrent: false, effectiveFrom: null, effectiveTo: null, expiresAt: null,
  elements: [table(4), table(4), table(2), table(2)], createdBy: 'a', createdAt: '2026-11-01T10:00:00Z',
  updatedBy: 'a', updatedAt: '2026-11-01T10:00:00Z', ...o,
})

describe('versionTimeline', () => {
  it('puts the current version first, then the next switch, then the rest newest first', () => {
    // As in the owner's screenshot: API order is newest first.
    const list = [
      snap(5), snap(4), snap(3),
      snap(2, { effectiveFrom: '2026-12-16T23:00:00Z' }),
      snap(1, { isCurrent: true, effectiveFrom: '2026-10-01T00:00:00Z', effectiveTo: '2026-12-16T23:00:00Z' }),
    ]
    const out = versionTimeline(list, NOW)
    expect(out.map((e) => [e.snapshot.version, e.kind])).toEqual([
      [1, 'current'], [2, 'next'], [5, 'unscheduled'], [4, 'unscheduled'], [3, 'unscheduled'],
    ])
    expect(out[1].from).toBe('2026-12-16T23:00:00Z')
    expect(out[0].from).toBeNull()
  })

  it('orders several upcoming switches by date', () => {
    const out = versionTimeline([
      snap(3, { effectiveFrom: '2027-02-01T00:00:00Z' }),
      snap(2, { effectiveFrom: '2027-01-01T00:00:00Z' }),
    ], NOW)
    expect(out.map((e) => e.snapshot.version)).toEqual([2, 3])
  })

  it('treats a past start without isCurrent as an old version, with its end date', () => {
    const [old] = versionTimeline([
      snap(1, { effectiveFrom: '2026-09-01T00:00:00Z', effectiveTo: '2026-10-01T00:00:00Z' }),
    ], NOW)
    expect(old.kind).toBe('unscheduled')
    expect(old.endedAt).toBe('2026-10-01T00:00:00Z')
  })

  it('is empty for no versions', () => {
    expect(versionTimeline([], NOW)).toEqual([])
  })
})

describe('counts and text', () => {
  it('counts tables, seats (2 when missing) and floors', () => {
    const s = snap(1, { elements: [table(4), table(), { type: 'floor' } as LayoutElement, { type: 'wall' } as LayoutElement] })
    expect(countsOf(s)).toEqual({ tables: 2, seats: 6, floors: 1 })
    expect(sizeText({ tables: 4, seats: 12, floors: 1 })).toBe('4 bord, 12 platser')
    expect(sizeText({ tables: 1, seats: 1, floors: 2 })).toBe('1 bord, 1 plats, 2 våningar')
  })

  it('shows the year only when it is not this year', () => {
    expect(shortDate('2026-12-17', NOW)).toBe('17 dec.')
    expect(shortDate('2027-01-05', NOW)).toBe('5 jan. 2027')
  })

  it('counts days to a local date', () => {
    expect(daysUntil('2026-12-10', NOW)).toBe(22)
  })
})
