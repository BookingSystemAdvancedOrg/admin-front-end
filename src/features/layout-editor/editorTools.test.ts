import { describe, expect, it } from 'vitest'
import { emptyFloor } from './data'
import { UNITS_PER_METER } from './layoutApi'
import type { Floor, TableElement } from './data'
import {
  HISTORY_LIMIT,
  actionForKey,
  isTypingTarget,
  keyForTool,
  nextTableNumber,
  nudgeDelta,
  panForZoom,
  pasteClip,
  record,
  UNITS_PER_METRE,
  formatMetres,
  formatSize,
  moveClipsTo,
  snapToGuides,
  tableRow,
  wallTowards,
  turnTable,
  redo,
  startHistory,
  undo,
} from './editorTools'

const table = (over: Partial<TableElement> = {}): TableElement => ({
  id: 't1', label: 'T1', shape: 'square', seats: 4, zone: 'Mitten', x: 0, y: 0, rotation: 0, w: 60, h: 40, ...over,
})
const floorsWith = (...tables: TableElement[]): Floor[] => [{ ...emptyFloor(1), tables }]

describe('history', () => {
  it('undoes and redoes whole steps', () => {
    const a = floorsWith()
    const b = floorsWith(table())
    const c = floorsWith(table(), table({ id: 't2' }))
    let h = record(record(startHistory(a), b), c)
    h = undo(h)!
    expect(h.present).toBe(b)
    h = undo(h)!
    expect(h.present).toBe(a)
    expect(undo(h)).toBeNull()
    h = redo(h)!
    expect(h.present).toBe(b)
  })

  it('a new edit after undo drops the redo branch', () => {
    const a = floorsWith()
    const b = floorsWith(table())
    const c = floorsWith(table({ x: 20 }))
    const h = record(undo(record(startHistory(a), b))!, c)
    expect(h.present).toBe(c)
    expect(redo(h)).toBeNull()
  })

  it('records nothing when nothing changed, and caps the length', () => {
    const a = floorsWith()
    expect(record(startHistory(a), a).past).toHaveLength(0)
    let h = startHistory(a)
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, floorsWith(table({ x: i })))
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('actionForKey', () => {
  it('maps the Figma-style shortcuts', () => {
    expect(actionForKey({ key: 'z', metaKey: true })).toEqual({ type: 'undo' })
    expect(actionForKey({ key: 'Z', metaKey: true, shiftKey: true })).toEqual({ type: 'redo' })
    expect(actionForKey({ key: 'y', ctrlKey: true })).toEqual({ type: 'redo' })
    expect(actionForKey({ key: 'd', ctrlKey: true })).toEqual({ type: 'duplicate' })
    expect(actionForKey({ key: 'c', metaKey: true })).toEqual({ type: 'copy' })
    expect(actionForKey({ key: 'v', metaKey: true })).toEqual({ type: 'paste' })
    expect(actionForKey({ key: 'Backspace' })).toEqual({ type: 'delete' })
    expect(actionForKey({ key: 'Delete' })).toEqual({ type: 'delete' })
    expect(actionForKey({ key: 'Escape' })).toEqual({ type: 'escape' })
    expect(actionForKey({ key: 'ArrowUp', shiftKey: true })).toEqual({ type: 'nudge', dx: 0, dy: -1, big: true })
    expect(actionForKey({ key: '!', code: 'Digit1', shiftKey: true })).toEqual({ type: 'zoom-fit' })
    expect(actionForKey({ key: '=', code: 'Digit0', shiftKey: true })).toEqual({ type: 'zoom-100' })
    expect(actionForKey({ key: '?' })).toEqual({ type: 'help' })
    expect(actionForKey({ key: 'R', shiftKey: true })).toEqual({ type: 'rotate' })
    expect(actionForKey({ key: 'a', metaKey: true })).toEqual({ type: 'select-all' })
    expect(actionForKey({ key: 'Enter' })).toEqual({ type: 'confirm' })
  })

  it('maps single letters to tools, but not with modifiers', () => {
    expect(actionForKey({ key: 'w' })).toEqual({ type: 'tool', tool: 'wall' })
    expect(actionForKey({ key: 'H' })).toEqual({ type: 'tool', tool: 'hand' })
    expect(actionForKey({ key: 'w', altKey: true })).toBeNull()
    expect(actionForKey({ key: 'W', shiftKey: true })).toBeNull()
    expect(actionForKey({ key: 'q' })).toBeNull()
    expect(keyForTool('add-round')).toBe('R')
  })
})

describe('isTypingTarget', () => {
  it('ignores shortcuts while typing in a field, not on buttons', () => {
    const input = document.createElement('input')
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' })
    expect(isTypingTarget(input)).toBe(true)
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(checkbox)).toBe(false)
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('nudgeDelta', () => {
  it('follows the screen when the view is not rotated', () => {
    expect(nudgeDelta(1, 0, 0, 20)).toEqual({ x: 20, y: 0 })
    expect(nudgeDelta(0, 1, 0, 20)).toEqual({ x: 0, y: 20 })
    expect(nudgeDelta(-1, 0, 0, 20)).toEqual({ x: -20, y: 0 })
    expect(nudgeDelta(0, -1, 0, 20)).toEqual({ x: 0, y: -20 })
  })

  it('maps through a 90 degree view: screen down is plan +x', () => {
    expect(nudgeDelta(0, 1, 90, 20)).toEqual({ x: 20, y: 0 })
    expect(nudgeDelta(1, 0, 90, 20)).toEqual({ x: 0, y: -20 })
  })

  it('gives four different directions at the default 45 degree view', () => {
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dy]) => JSON.stringify(nudgeDelta(dx, dy, 45, 20)))
    expect(new Set(dirs).size).toBe(4)
  })
})

describe('copy and paste', () => {
  it('numbers tables across every floor', () => {
    const floors = [...floorsWith(table({ label: 'T3' })), { ...emptyFloor(2), tables: [table({ id: 'x', label: 'T12' })] }]
    expect(nextTableNumber(floors)).toBe(13)
    expect(nextTableNumber([emptyFloor(1)])).toBe(1)
  })

  it('pastes a table offset, with a new id and number, inside the workspace', () => {
    let n = 0
    const out = pasteClip({ kind: 'table', table: table() }, 1, () => `new${++n}`, () => 'T9')
    expect(out).toMatchObject({ kind: 'table', table: { id: 'new1', label: 'T9', x: 40, y: 40, seats: 4 } })
    const edge = pasteClip({ kind: 'table', table: table({ x: 580 }) }, 3, () => 'n', () => 'T2')
    expect(edge.kind === 'table' && edge.table.x).toBe(570)
  })

  it('pastes a wall beside the original, not on top of it', () => {
    const wall = { id: 'w1', dir: 'h' as const, x: 0, y: 0, length: 200 }
    const out = pasteClip({ kind: 'wall', wall }, 1, () => 'w2', () => '')
    expect(out).toEqual({ kind: 'wall', wall: { id: 'w2', dir: 'h', x: 0, y: 40, length: 200 } })
  })
})

describe('panForZoom', () => {
  it('keeps the point under the cursor still', () => {
    const pan = { x: 10, y: -20 }
    const cursor = { x: 200, y: 100 }
    const next = panForZoom(pan, cursor, 1, 2)
    // a world point at the cursor: (cursor - pan) / zoom stays the same
    expect((cursor.x - next.x) / 2).toBeCloseTo((cursor.x - pan.x) / 1)
    expect((cursor.y - next.y) / 2).toBeCloseTo((cursor.y - pan.y) / 1)
  })
})

describe('turnTable', () => {
  it('swaps width and depth around the same centre, and leaves round tables alone', () => {
    expect(turnTable(table({ w: 100, h: 40, x: 20, y: 0 }))).toMatchObject({ w: 40, h: 100, x: 20, y: 0, rotation: 0 })
    const round = table({ shape: 'round', w: 60, h: 60 })
    expect(turnTable(round)).toBe(round)
  })

  it('keeps a turned table inside the workspace', () => {
    expect(turnTable(table({ w: 40, h: 200, x: 0, y: 440 })).y).toBe(430)
  })
})

describe('tableRow', () => {
  it('lays out copies with a gap, numbered in order', () => {
    let id = 0
    let n = 5
    const row = tableRow(table({ w: 60, h: 40 }), 3, { x: 1, y: 0 }, 40, () => `r${++id}`, () => `T${n++}`)
    expect(row.map((t) => [t.id, t.label, t.x, t.y])).toEqual([
      ['r1', 'T5', 100, 0],
      ['r2', 'T6', 200, 0],
      ['r3', 'T7', 300, 0],
    ])
  })

  it('stops at the edge of the workspace', () => {
    const row = tableRow(table({ w: 60, h: 40, y: 300 }), 10, { x: 0, y: 1 }, 20, () => 'x', () => 'T')
    expect(row).toHaveLength(2) // y 360 and 420 fit, 480 does not
  })
})

describe('snapToGuides', () => {
  const box = { x: 103, y: 0, w: 60, h: 40 }

  it('snaps a centre line to another table and returns a guide', () => {
    const other = { x: 100, y: 200, w: 60, h: 40 }
    const out = snapToGuides(box, [other], [], 8)
    expect(out.dx).toBe(-3)
    expect(out.dy).toBe(0)
    // same size: left edges, centres and right edges all line up
    expect(out.guides.map((g) => g.at)).toEqual([70, 100, 130])
    expect(out.guides[1]).toEqual({ axis: 'x', at: 100, from: -30, to: 230 })
  })

  it('snaps an edge to a wall', () => {
    const wall = { id: 'w', dir: 'h' as const, x: 0, y: -24, length: 300 }
    const out = snapToGuides(box, [], [wall], 8)
    expect(out.dy).toBe(-4) // top edge -20 -> -24
    expect(out.guides[0]).toMatchObject({ axis: 'y', at: -24 })
  })

  it('does nothing outside the threshold', () => {
    expect(snapToGuides(box, [{ x: 300, y: 300, w: 60, h: 40 }], [], 8)).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})

describe('measurements', () => {
  it('uses the same scale as the layout API', () => {
    expect(UNITS_PER_METRE).toBe(UNITS_PER_METER)
  })

  it('shows metres with a Swedish decimal comma', () => {
    expect(formatMetres(160)).toBe('3,2 m')
    expect(formatMetres(20)).toBe('0,4 m')
    expect(formatSize(200, 160)).toBe('4,0 × 3,2 m')
  })
})

describe('moveClipsTo', () => {
  it('moves the group so its centre lands on the point, on the grid', () => {
    const clips = moveClipsTo(
      [
        { kind: 'table', table: table({ x: 0, y: 0 }) },
        { kind: 'table', table: table({ id: 't2', x: 100, y: 0 }) },
      ],
      { x: 250, y: 103 },
    )
    expect(clips.map((c) => (c.kind === 'table' ? [c.table.x, c.table.y] : null))).toEqual([[200, 100], [300, 100]])
  })
})

describe('wallTowards', () => {
  it('follows the dominant direction and reports the far end', () => {
    expect(wallTowards(0, 0, 100, 20)).toEqual({ dir: 'h', x: 0, y: 0, length: 100, end: { x: 100, y: 0 } })
    expect(wallTowards(0, 0, -20, -140)).toEqual({ dir: 'v', x: 0, y: -140, length: 140, end: { x: 0, y: -140 } })
    expect(wallTowards(40, 40, -60, 40)).toEqual({ dir: 'h', x: -60, y: 40, length: 100, end: { x: -60, y: 40 } })
  })
})
