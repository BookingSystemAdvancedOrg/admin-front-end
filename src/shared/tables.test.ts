import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { ApiError } from './api'
import { clearTablesCache, loadTables, tableNames, tablesFromLayout } from './tables'

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
    expect(tableNames(['gone'], labels)).toBe('Bord ?')
    expect(tableNames([], labels)).toBe('-')
    expect(tableNames(['raw'], null)).toBe('Bord raw')
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
