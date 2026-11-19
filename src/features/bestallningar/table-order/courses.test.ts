import { describe, expect, it } from 'vitest'
import { COURSE_LABEL, COURSE_ORDER, defaultHold, heldByCourse, startersPending } from './courses'
import type { Tab, TabItem, TabRound } from './types'

function item(extra: Partial<TabItem>): TabItem {
  return {
    itemId: 'i1', menuItemId: 'm', name: 'Rätt', unitPrice: 10000, quantity: 1, options: [], course: 'starters',
    stationId: 'kok', stationName: 'Kök', state: 'sent', round: 1, addedAt: '2026-11-19T17:00:00Z', addedByName: 'Anna',
    ...extra,
  }
}

function tab(items: TabItem[], rounds: Partial<TabRound>[] = []): Tab {
  return {
    tabId: 'a'.repeat(32), status: 'open', tableId: 't3', tableLabel: '3', covers: 4, guestName: null, reservationId: null,
    items, rounds: rounds.map((r) => ({ round: 1, kind: 'order', at: '', byName: 'Anna', courses: [], itemIds: [], dispatched: true, stations: [], ...r })),
    referenceTotal: 0, openedAt: '2026-11-19T17:00:00Z', openedByName: 'Anna', version: 1, updatedAt: '',
  }
}

describe('courses', () => {
  it('lists the courses in serving order with Swedish labels', () => {
    expect(COURSE_ORDER.map((c) => COURSE_LABEL[c])).toEqual(['Dryck', 'Förrätt', 'Varmrätt', 'Efterrätt', 'Övrigt'])
  })

  it('sends drinks, starters and other now by default', () => {
    const hold = defaultHold(['drinks', 'starters', 'other'], null)
    expect(hold.drinks).toBe(false)
    expect(hold.starters).toBe(false)
    expect(hold.other).toBe(false)
  })

  it('holds mains when starters go in the same send', () => {
    expect(defaultHold(['starters', 'mains'], null).mains).toBe(true)
    expect(defaultHold(['mains'], null).mains).toBe(false)
  })

  it('holds mains while the tab has starters that are not ready', () => {
    const cooking = tab([item({})], [{ round: 1, tickets: [{ stationId: 'kok', stationName: 'Kök', status: 'preparing' }] }])
    expect(defaultHold(['mains'], cooking).mains).toBe(true)
    const ready = tab([item({})], [{ round: 1, tickets: [{ stationId: 'kok', stationName: 'Kök', status: 'ready' }] }])
    expect(defaultHold(['mains'], ready).mains).toBe(false)
  })

  it('counts held starters and starters without ticket states as pending', () => {
    expect(startersPending(tab([item({ state: 'held', round: undefined })]))).toBe(true)
    expect(startersPending(tab([item({})], [{ round: 1 }]))).toBe(true)
    expect(startersPending(tab([item({ state: 'void' })]))).toBe(false)
    expect(startersPending(null)).toBe(false)
  })

  it('holds desserts when starters or mains are in the send or on the tab', () => {
    expect(defaultHold(['desserts'], null).desserts).toBe(false)
    expect(defaultHold(['mains', 'desserts'], null).desserts).toBe(true)
    expect(defaultHold(['desserts'], tab([item({ course: 'mains' })])).desserts).toBe(true)
    expect(defaultHold(['desserts'], tab([item({ course: 'mains', state: 'void' })])).desserts).toBe(false)
  })

  it('sums held items per course', () => {
    const t = tab([
      item({ itemId: 'a', course: 'mains', state: 'held', quantity: 2 }),
      item({ itemId: 'b', course: 'mains', state: 'held', quantity: 1 }),
      item({ itemId: 'c', course: 'desserts', state: 'held', quantity: 4 }),
      item({ itemId: 'd', course: 'starters', state: 'sent', quantity: 3 }),
    ])
    expect(heldByCourse(t)).toEqual([{ course: 'mains', quantity: 3 }, { course: 'desserts', quantity: 4 }])
  })
})
