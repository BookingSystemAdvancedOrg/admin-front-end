import { describe, expect, it } from 'vitest'
import { SEAT_SIZE, defaultTableSize, seatPositions } from './data'
import type { TableShape } from './data'

/** Bygger ett minimalt bord med ett standardförslag på storlek. */
function table(shape: TableShape, seats: number) {
  return { shape, seats, ...defaultTableSize(shape, seats) }
}

describe('seatPositions', () => {
  it('places exactly one seat per seat count', () => {
    for (const seats of [1, 2, 4, 6, 8, 12]) {
      expect(seatPositions(table('square', seats))).toHaveLength(seats)
      expect(seatPositions(table('round', seats))).toHaveLength(seats)
    }
  })

  it('returns nothing for a table with no seats', () => {
    expect(seatPositions(table('square', 0))).toEqual([])
  })

  it('spaces round seats evenly on a circle outside the table', () => {
    const seats = 4
    const t = table('round', seats)
    const positions = seatPositions(t)
    const expected = t.w / 2 + 4 + SEAT_SIZE / 2
    for (const p of positions) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(expected, 5)
    }
  })

  it('seats a four-top opposite each other rather than in the corners', () => {
    const positions = seatPositions(table('square', 4))
    // Två stolar ovanför bordet och två under, ingen ute på sidorna.
    const above = positions.filter((p) => p.y < 0)
    const below = positions.filter((p) => p.y > 0)
    expect(above).toHaveLength(2)
    expect(below).toHaveLength(2)
  })

  it('keeps every seat clear of the table top', () => {
    const t = table('square', 8)
    for (const p of seatPositions(t)) {
      const outsideX = Math.abs(p.x) >= t.w / 2
      const outsideY = Math.abs(p.y) >= t.h / 2
      expect(outsideX || outsideY).toBe(true)
    }
  })

  it('distributes seats around all four sides once there are enough', () => {
    const t = table('square', 8)
    const positions = seatPositions(t)
    const onSides = positions.filter((p) => Math.abs(p.x) > t.w / 2)
    expect(onSides.length).toBeGreaterThan(0)
  })

  it('works for a manually resized, elongated table', () => {
    // Ett bord som dragits ut till en avlång rektangel — inte längre
    // härlett ur antal platser, men platserna ska fortfarande hamna
    // utanför den faktiska kanten.
    const t = { shape: 'square' as const, seats: 6, w: 200, h: 60 }
    for (const p of seatPositions(t)) {
      const outsideX = Math.abs(p.x) >= t.w / 2
      const outsideY = Math.abs(p.y) >= t.h / 2
      expect(outsideX || outsideY).toBe(true)
    }
  })
})
