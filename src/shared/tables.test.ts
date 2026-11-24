import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { ApiError } from './api'
import { bookingLabels, clearTablesCache, loadTables, orderTable, stampedLabels, tableNames, tablesText, tableTitle, tablesFromLayout } from './tables'

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  apiFetch: vi.fn(),
}))
const apiFetch = vi.mocked(api.apiFetch)

const el = (elementId: string, extra: Record<string, unknown> = {}) => ({
  elementId, type: 'table', seats: 4, ...extra,
})

beforeEach(() => {
  apiFetch.mockReset()
  clearTablesCache()
})
afterEach(() => clearTablesCache())

describe('tables', () => {
  it('numbers tables like the booking site: floors by level, drawing order', () => {
    const tables = tablesFromLayout({
      floors: [
        { floorId: 'upper', level: 1 },
        { floorId: 'ground', level: 0 },
      ],
      elements: [
        el('u1', { floorId: 'upper', seats: 2 }),
        { elementId: 'wall', type: 'wall', floorId: 'ground' },
        el('g1', { floorId: 'ground', seats: 6 }),
        el('g2', { floorId: 'ground', label: 'Bar' }),
      ],
    })
    expect(tables).toEqual([
      { tableId: 'g1', label: '1', seats: 6 },
      { tableId: 'g2', label: 'Bar', seats: 4 },
      { tableId: 'u1', label: '3', seats: 2 },
    ])
  })

  it('a flat layout is one floor', () => {
    expect(tablesFromLayout({ floors: [], elements: [el('a'), el('b')] }).map((t) => t.label)).toEqual(['1', '2'])
  })

  it('names tables, never shows the long ids', () => {
    const labels = new Map([['uuid-1', '1'], ['uuid-3', '3']])
    expect(tableNames(['uuid-1', 'uuid-3'], labels)).toBe('Bord 1, 3')
    expect(tableNames(['gone'], labels)).toBe('Borttaget bord')
    expect(tableNames(['uuid-1', 'gone'], labels)).toBe('Bord 1, borttaget bord')
    expect(tableNames(['gone', 'gone-2'], labels)).toBe('2 borttagna bord')
    expect(tableNames([], labels)).toBe('-')
    expect(tableNames(['raw'], null)).toBe('Ett bord')
    expect(tableNames(['a', 'b'], null)).toBe('2 bord')
  })

  it("shows a table's own name without the word Bord", () => {
    expect(tableTitle('Bar')).toBe('Bar')
    expect(tableTitle('3')).toBe('Bord 3')
    expect(tableNames(['b'], new Map([['b', 'Bar']]))).toBe('Bar')
    expect(tableNames(['a', 'b'], new Map([['a', '3'], ['b', 'Bar']]))).toBe('Bord 3, Bar')
    expect(tablesText(['3', '4'], (p) => p.join(' + '))).toBe('Bord 3 + 4')
    expect(tablesText(['1', '?'], (p) => p.join(' + '))).toBe('Bord 1 + ?')
  })

  it("names a booking's tables by its stamped labels before today's layout", () => {
    const active = new Map([['t-a', '5']])
    // Bokningen gäller version 2, där bordet är nummer 6 (som mejlet säger).
    const b = { tableIds: ['t-a'], tableLabels: ['6'], layoutVersion: 2 }
    expect(bookingLabels(b, active)?.get('t-a')).toBe('6')
    // Stämpeln räcker även när ritningen inte gick att hämta.
    expect(bookingLabels(b, null)?.get('t-a')).toBe('6')
    // Ett bord som bara finns i bokningens version.
    expect(bookingLabels({ tableIds: ['t-new'], tableLabels: ['7'] }, active)?.get('t-new')).toBe('7')
  })

  it('an older booking without labels uses its version, then the active layout', () => {
    const active = new Map([['t-a', '5']])
    const versions = new Map([[2, new Map([['t-b', '8']])]])
    expect(bookingLabels({ tableIds: ['t-a'] }, active)?.get('t-a')).toBe('5')
    expect(bookingLabels({ tableIds: ['t-b'], layoutVersion: 2 }, active, versions)?.get('t-b')).toBe('8')
    expect(bookingLabels({ tableIds: ['t-b'], layoutVersion: 2 }, active)?.has('t-b')).toBe(false)
    expect(bookingLabels({ tableIds: ['t-a'] }, null)).toBeNull()
  })

  it('ignores a label stamp that does not line up with the tables', () => {
    expect(stampedLabels({ tableIds: ['a', 'b'], tableLabels: ['1'] })).toBeNull()
    expect(stampedLabels({ tableIds: ['a'], tableLabels: [' '] })).toBeNull()
    expect(stampedLabels({ tableIds: ['a'] })).toBeNull()
    expect(stampedLabels({ tableIds: ['a', 'b'], tableLabels: ['3', ' Bar '] })).toEqual(['3', 'Bar'])
  })

  it('an order at a table removed from the layout shows its stored label, or Borttaget bord', () => {
    const labels = new Map([['uuid-1', '1']])
    expect(tableTitle(orderTable('gone', '7', labels).label)).toBe('Bord 7')
    expect(tableTitle(orderTable('gone', undefined, labels).label)).toBe('Borttaget bord')
    expect(tableTitle(orderTable(undefined, '  ', labels).label)).toBe('Borttaget bord')
    expect(tableTitle(orderTable('uuid-1', '9', labels).label)).toBe('Bord 1')
    expect(tableTitle(orderTable('x', undefined, null).label)).not.toContain('?')
  })

  it('caches the layout for a minute and treats no layout as no tables', async () => {
    apiFetch.mockResolvedValue({ floors: [], elements: [el('a')] })
    await loadTables('loc-1', 1_000)
    await loadTables('loc-1', 30_000)
    expect(apiFetch).toHaveBeenCalledTimes(1)
    await loadTables('loc-1', 70_000)
    expect(apiFetch).toHaveBeenCalledTimes(2)

    apiFetch.mockRejectedValueOnce(new ApiError(404, 'not found'))
    expect(await loadTables('loc-2')).toEqual([])
  })

  it('a failed fetch is not cached', async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(503, 'down'))
    await expect(loadTables('loc-1', 1_000)).rejects.toThrow('down')
    apiFetch.mockResolvedValue({ floors: [], elements: [el('a')] })
    expect(await loadTables('loc-1', 2_000)).toHaveLength(1)
  })
})
