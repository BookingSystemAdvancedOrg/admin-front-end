import { afterEach, describe, expect, it, vi } from 'vitest'
import { centreOf, originFor, setOrigin } from './origin'
import * as press from '../press'

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

describe('originFor', () => {
  it('is the point relative to the panel', () => {
    expect(originFor(rect(100, 200, 300, 200), { x: 150, y: 210 })).toBe('50px 10px')
  })

  it('keeps a far-away trigger within half a panel outside', () => {
    expect(originFor(rect(100, 100, 200, 100), { x: 2000, y: -500 })).toBe('300px -50px')
  })
})

describe('setOrigin', () => {
  afterEach(() => vi.restoreAllMocks())

  it('grows from the anchor button', () => {
    const panel = document.createElement('div')
    const anchor = document.createElement('button')
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(0, 40, 200, 100))
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(160, 0, 40, 40))
    setOrigin(panel, anchor)
    expect(panel.style.transformOrigin).toBe('180px -20px')
  })

  it('falls back to the last press, and leaves CSS alone without one', () => {
    const panel = document.createElement('div')
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(rect(10, 10, 100, 100))
    vi.spyOn(press, 'lastPress').mockReturnValue(null)
    setOrigin(panel)
    expect(panel.style.transformOrigin).toBe('')
    vi.spyOn(press, 'lastPress').mockReturnValue({ x: 60, y: 30 })
    setOrigin(panel)
    expect(panel.style.transformOrigin).toBe('50px 20px')
  })

  it('has no centre for an element without a box', () => {
    expect(centreOf(document.createElement('span'))).toBeNull()
  })
})
