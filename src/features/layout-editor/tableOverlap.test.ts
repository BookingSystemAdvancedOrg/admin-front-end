import { describe, expect, it } from 'vitest'
import { GRID, WORKSPACE, defaultTableSize } from './data'
import type { TableElement } from './data'
import { actionForKey, freeTableSpot, overlappingTableIds, tablesOverlap } from './editorTools'

function table(id: string, x: number, y: number, over: Partial<TableElement> = {}): TableElement {
  return {
    id,
    label: id,
    shape: 'square',
    seats: 4,
    zone: 'Mitten',
    x,
    y,
    rotation: 0,
    ...defaultTableSize(over.shape ?? 'square', 4),
    ...over,
  }
}

const everywhere = { minX: -WORKSPACE.w / 2, minY: -WORKSPACE.h / 2, maxX: WORKSPACE.w / 2, maxY: WORKSPACE.h / 2 }

describe('tablesOverlap', () => {
  it('flags two square tables on top of each other', () => {
    expect(tablesOverlap(table('a', 0, 0), table('b', 20, 10))).toBe(true)
  })

  it('does not flag tables that only touch edge to edge', () => {
    const a = table('a', 0, 0)
    expect(tablesOverlap(a, table('b', a.w, 0))).toBe(false)
  })

  it('uses real circles for round tables, so diagonal neighbours are free', () => {
    const r = { shape: 'round' as const, w: 60, h: 60 }
    // Rutorna runt cirklarna skulle gå in i varandra, cirklarna gör det inte.
    expect(tablesOverlap(table('a', 0, 0, r), table('b', 50, 50, r))).toBe(false)
    expect(tablesOverlap(table('a', 0, 0, r), table('b', 30, 30, r))).toBe(true)
  })

  it('handles a round table against a square one', () => {
    const r = { shape: 'round' as const, w: 60, h: 60 }
    const sq = table('sq', 0, 0, { w: 100, h: 60 })
    expect(tablesOverlap(table('r', 70, 0, r), sq)).toBe(true)
    expect(tablesOverlap(table('r', 90, 50, r), sq)).toBe(false)
  })
})

describe('overlappingTableIds', () => {
  it('lists every table in a crash and nothing else', () => {
    const ids = overlappingTableIds([table('a', 0, 0), table('b', 10, 0), table('c', 300, 300)])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('is empty for a clean plan', () => {
    expect(overlappingTableIds([table('a', 0, 0), table('b', 200, 0)]).size).toBe(0)
  })
})

describe('freeTableSpot', () => {
  const size = { shape: 'square' as const, ...defaultTableSize('square', 4) }

  it('uses the start when it is free', () => {
    expect(freeTableSpot([], size, { x: 0, y: 0 }, everywhere)).toEqual({ x: 0, y: 0 })
  })

  it('never stacks repeated clicks: four new tables, no overlap', () => {
    const tables: TableElement[] = []
    for (let i = 0; i < 4; i++) {
      const p = freeTableSpot(tables, size, { x: 0, y: 0 }, everywhere)
      tables.push(table(`t${i}`, p.x, p.y))
    }
    expect(overlappingTableIds(tables).size).toBe(0)
    expect(new Set(tables.map((t) => `${t.x},${t.y}`)).size).toBe(4)
    for (const t of tables) {
      expect(Math.abs(t.x % GRID)).toBe(0)
      expect(Math.abs(t.y % GRID)).toBe(0)
    }
  })

  it('stays inside the visible area when there is room', () => {
    const area = { minX: -200, minY: -150, maxX: 200, maxY: 150 }
    const tables: TableElement[] = []
    for (let i = 0; i < 4; i++) {
      const p = freeTableSpot(tables, size, { x: 0, y: 0 }, area)
      tables.push(table(`t${i}`, p.x, p.y))
    }
    for (const t of tables) {
      expect(t.x - t.w / 2).toBeGreaterThanOrEqual(area.minX)
      expect(t.x + t.w / 2).toBeLessThanOrEqual(area.maxX)
      expect(t.y - t.h / 2).toBeGreaterThanOrEqual(area.minY)
      expect(t.y + t.h / 2).toBeLessThanOrEqual(area.maxY)
    }
    expect(overlappingTableIds(tables).size).toBe(0)
  })

  it('looks outside the visible area when it is full', () => {
    const area = { minX: -50, minY: -40, maxX: 50, maxY: 40 }
    const first = table('a', 0, 0)
    const p = freeTableSpot([first], size, { x: 0, y: 0 }, area)
    expect(tablesOverlap(table('b', p.x, p.y), first)).toBe(false)
  })
})

describe('the Kassa tool is gone', () => {
  it('has no keyboard shortcut on C', () => {
    expect(actionForKey({ key: 'c' })).toBeNull()
  })
})
