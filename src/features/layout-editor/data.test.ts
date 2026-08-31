import { describe, expect, it } from 'vitest'
import { SEAT_SIZE, seatPositions, tableSize } from './data'

describe('seatPositions', () => {
  it('places exactly one seat per seat count', () => {
    for (const seats of [1, 2, 4, 6, 8, 12]) {
      expect(seatPositions({ shape: 'square', seats })).toHaveLength(seats)
      expect(seatPositions({ shape: 'round', seats })).toHaveLength(seats)
    }
  })

  it('returns nothing for a table with no seats', () => {
    expect(seatPositions({ shape: 'square', seats: 0 })).toEqual([])
  })

  it('spaces round seats evenly on a circle outside the table', () => {
    const seats = 4
    const positions = seatPositions({ shape: 'round', seats })
    const size = tableSize({ shape: 'round', seats })
    const expected = size.w / 2 + 4 + SEAT_SIZE / 2
    for (const p of positions) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(expected, 5)
    }
  })

  it('seats a four-top opposite each other rather than in the corners', () => {
    const positions = seatPositions({ shape: 'square', seats: 4 })
    // Två stolar ovanför bordet och två under, ingen ute på sidorna.
    const above = positions.filter((p) => p.y < 0)
    const below = positions.filter((p) => p.y > 0)
    expect(above).toHaveLength(2)
    expect(below).toHaveLength(2)
  })

  it('keeps every seat clear of the table top', () => {
    const seats = 8
    const size = tableSize({ shape: 'square', seats })
    for (const p of seatPositions({ shape: 'square', seats })) {
      const outsideX = Math.abs(p.x) >= size.w / 2
      const outsideY = Math.abs(p.y) >= size.h / 2
      expect(outsideX || outsideY).toBe(true)
    }
  })

  it('distributes seats around all four sides once there are enough', () => {
    const size = tableSize({ shape: 'square', seats: 8 })
    const positions = seatPositions({ shape: 'square', seats: 8 })
    const onSides = positions.filter((p) => Math.abs(p.x) > size.w / 2)
    expect(onSides.length).toBeGreaterThan(0)
  })
})
