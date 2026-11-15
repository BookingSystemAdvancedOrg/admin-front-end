import { describe, expect, it } from 'vitest'
import { CENTRE, clampFocus, dragFocus, focusLabel, focusPosition, isCentre, nudgeFocus, sameFocus } from './imageFocus'

describe('clampFocus', () => {
  it('keeps whole percents inside 0 to 100', () => {
    expect(clampFocus({ x: -20, y: 140 })).toEqual({ x: 0, y: 100 })
    expect(clampFocus({ x: 33.4, y: 66.6 })).toEqual({ x: 33, y: 67 })
  })

  it('turns missing and broken values into the centre', () => {
    expect(clampFocus(null)).toEqual(CENTRE)
    expect(clampFocus(undefined)).toEqual(CENTRE)
    expect(clampFocus({ x: Number.NaN, y: Infinity })).toEqual(CENTRE)
    expect(clampFocus({ x: 10 })).toEqual({ x: 10, y: 50 })
  })

  it('compares and formats through the clamp', () => {
    expect(isCentre(null)).toBe(true)
    expect(isCentre({ x: 50.2, y: 49.8 })).toBe(true)
    expect(sameFocus(null, { x: 50, y: 50 })).toBe(true)
    expect(sameFocus({ x: 10, y: 10 }, { x: 11, y: 10 })).toBe(false)
    expect(focusPosition({ x: 120, y: 30 })).toBe('100% 30%')
    expect(focusPosition(null)).toBe('50% 50%')
  })
})

describe('dragFocus', () => {
  // ett liggande foto 400x200 i en 4:3-ram 160x120: skalan blir 0.6, bilden
  // är 240 px bred och sticker ut 80 px i sidled, inget på höjden
  const frame = { width: 160, height: 120 }
  const natural = { width: 400, height: 200 }

  it('moves the focus opposite to the drag on the axis that overflows', () => {
    expect(dragFocus(CENTRE, 40, 0, frame, natural)).toEqual({ x: 0, y: 50 })
    expect(dragFocus(CENTRE, -20, 0, frame, natural)).toEqual({ x: 75, y: 50 })
  })

  it('leaves an axis without overflow alone', () => {
    expect(dragFocus(CENTRE, 0, 60, frame, natural)).toEqual(CENTRE)
  })

  it('clamps at the edges however far the pointer goes', () => {
    expect(dragFocus(CENTRE, 5000, 0, frame, natural)).toEqual({ x: 0, y: 50 })
    expect(dragFocus(CENTRE, -5000, 0, frame, natural)).toEqual({ x: 100, y: 50 })
  })

  it('ignores an image that has not loaded yet', () => {
    expect(dragFocus({ x: 20, y: 30 }, 50, 50, frame, { width: 0, height: 0 })).toEqual({ x: 20, y: 30 })
  })
})

describe('nudgeFocus', () => {
  it('moves like dragging with the arrows, a larger step with shift, and clamps', () => {
    expect(nudgeFocus(CENTRE, 'ArrowRight')).toEqual({ x: 48, y: 50 })
    expect(nudgeFocus(CENTRE, 'ArrowLeft')).toEqual({ x: 52, y: 50 })
    expect(nudgeFocus(CENTRE, 'ArrowDown', true)).toEqual({ x: 50, y: 40 })
    expect(nudgeFocus({ x: 50, y: 99 }, 'ArrowUp', true)).toEqual({ x: 50, y: 100 })
    expect(nudgeFocus(CENTRE, 'a')).toBeNull()
  })
})

describe('focusLabel', () => {
  it('names the part in Swedish', () => {
    expect(focusLabel(CENTRE)).toBe('mitten')
    expect(focusLabel({ x: 90, y: 10 })).toBe('uppe till höger')
    expect(focusLabel({ x: 10, y: 50 })).toBe('till vänster')
    expect(focusLabel({ x: 50, y: 90 })).toBe('nere')
  })
})
