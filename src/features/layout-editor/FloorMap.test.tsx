import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FloorMap } from './FloorMap'
import type { TableView } from './FloorMap'
import type { Floor, TableElement } from './data'

const table = (id: string, x: number, w: number, h: number): TableElement => ({
  id,
  label: id,
  shape: 'square',
  seats: 2,
  zone: 'Mitten',
  x,
  y: 0,
  rotation: 0,
  w,
  h,
})

// Ett litet (35 x 35) och ett större bord (50 x 50) i ett brett rum.
const FLOOR: Floor = {
  id: 'f1',
  name: 'Entréplan',
  grounds: [{ id: 'g1', x: -350, y: -225, w: 700, h: 450 }],
  walls: [],
  openings: [],
  tables: [table('1', -100, 35, 35), table('2', 100, 50, 50)],
}

const view = (): TableView => ({
  state: 'free',
  selected: false,
  focusable: true,
  disabled: false,
  name: 'Bord',
  onPick: () => {},
})

/** Kartan på skärmen: `width` px bred (rummet är 760 enheter brett med luft). */
function onScreen(width: number) {
  let fire = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        fire = cb
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height: width,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: width,
    toJSON: () => ({}),
  } as DOMRect)
  return () => act(() => fire())
}

const hit = (id: string) => Number(document.querySelector(`.floor-map-hit[data-table="${id}"]`)!.getAttribute('r'))
const seats = (id: string) =>
  screen.getAllByRole('button').find((b) => b.querySelector('.floor-map-label')?.textContent?.trim() === id)!
    .querySelector('.floor-map-seats')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('FloorMap', () => {
  it('keeps the plan-unit tap areas and seat counts when no screen minimum is asked for', () => {
    const measure = onScreen(300)
    render(<FloorMap floor={FLOOR} label={(t) => t.label} view={view} hitPad={30} />)
    measure()
    expect(hit('1')).toBe(35 / 2 + 30)
    expect(hit('2')).toBe(50 / 2 + 30)
    expect(seats('1')).toBeInTheDocument()
    // Det låga bordet: platsantalet ligger inne på bordet.
    expect(Number(seats('1')!.getAttribute('y')) + 6).toBeLessThanOrEqual(35 / 2)
    expect(seats('2')).toHaveAttribute('y', '14')
  })

  it('grows tap areas to the screen minimum in a wide room, and hides seats that would be too small to read', () => {
    const measure = onScreen(300)
    render(<FloorMap floor={FLOOR} label={(t) => t.label} view={view} hitPad={30} minHitPx={44} minSeatPx={9} />)
    measure()
    const px = 300 / 760
    expect(hit('1') * 2 * px).toBeGreaterThanOrEqual(44 - 0.01)
    expect(hit('2') * 2 * px).toBeGreaterThanOrEqual(44 - 0.01)
    // 9 px på skärmen är 23 enheter: ryms inte på något av borden.
    expect(seats('1')).toBeNull()
    expect(seats('2')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('shows seats at the screen minimum where they fit', () => {
    const measure = onScreen(760)
    render(<FloorMap floor={FLOOR} label={(t) => t.label} view={view} hitPad={30} minHitPx={44} minSeatPx={14} />)
    measure()
    // 1 px per enhet: platsantalet 14 enheter, bara på det större bordet.
    expect(seats('1')).toBeNull()
    expect(seats('2')).toHaveStyle({ fontSize: '14px' })
    expect(hit('2')).toBe(50 / 2 + 30)
  })
})
