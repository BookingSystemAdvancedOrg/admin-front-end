import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import * as api from '../../shared/api'
import {
  UNITS_PER_METER,
  diffLayout,
  listLayoutElements,
  loadLayoutExtras,
  saveFloor,
  saveLayoutExtras,
  toApiElements,
  toDoorKinds,
  toFloorElements,
} from './layoutApi'
import type { LayoutElement } from './layoutApi'
import type { Floor } from './data'

vi.mock('../../shared/api', async () => {
  const actual =
    await vi.importActual<typeof import('../../shared/api')>('../../shared/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockedApiFetch = vi.mocked(api.apiFetch)

function element(over: Partial<LayoutElement>): LayoutElement {
  return {
    elementId: 'el-1',
    type: 'wall',
    x: 0,
    y: 0,
    z: 0,
    width: 1,
    height: 1.8,
    depth: 0.2,
    rotationY: 0,
    updatedBy: 'sub-1',
    updatedAt: '2026-08-31T10:00:00Z',
    ...over,
  }
}

const floor: Floor = {
  id: 'floor-1',
  name: 'Våning 1',
  grounds: [{ id: 'g1', x: -100, y: -100, w: 200, h: 200 }],
  walls: [
    { id: 'w-n', dir: 'h', x: -100, y: -100, length: 200 },
    { id: 'w-w', dir: 'v', x: -100, y: -100, length: 200 },
  ],
  openings: [
    { id: 'o-1', kind: 'window', wallId: 'w-n', offset: 40, length: 60 },
  ],
  fixtures: [
    { id: 'f-1', type: 'counter', label: 'KASSA', x: 0, y: 0, w: 100, h: 36 },
  ],
  tables: [
    {
      id: 't1',
      label: 'T1',
      shape: 'square',
      seats: 4,
      zone: 'Mitten',
      x: 50,
      y: 20,
      rotation: 90,
    },
  ],
}

beforeEach(() => {
  mockedApiFetch.mockReset()
  localStorage.clear()
})

describe('editor -> API mapping', () => {
  it('places a horizontal wall by its centre, not its start point', () => {
    const wall = toApiElements(floor).get('w-n')
    expect(wall).toMatchObject({ type: 'wall', rotationY: 0 })
    // Start -100, längd 200 -> mittpunkt 0 i editorenheter.
    expect(wall?.x).toBe(0)
    expect(wall?.z).toBe(-100 / UNITS_PER_METER)
    expect(wall?.width).toBe(200 / UNITS_PER_METER)
  })

  it('marks a vertical wall with rotationY 90 and offsets along z', () => {
    const wall = toApiElements(floor).get('w-w')
    expect(wall).toMatchObject({ rotationY: 90 })
    expect(wall?.x).toBe(-100 / UNITS_PER_METER)
    expect(wall?.z).toBe(0)
  })

  it('positions an opening at its absolute point on the wall', () => {
    const opening = toApiElements(floor).get('o-1')
    // Vägg startar på -100, öppningen 40 in med längd 60 -> mitt på -30.
    expect(opening).toMatchObject({ type: 'window', wallId: 'w-n' })
    expect(opening?.x).toBe(-30 / UNITS_PER_METER)
    expect(opening?.width).toBe(60 / UNITS_PER_METER)
  })

  it('maps a table to the spec example dimensions', () => {
    const table = toApiElements(floor).get('t1')
    // Fyrsitsigt fyrkantsbord: 68x45 enheter -> 1.36 x 0.90 m.
    expect(table).toMatchObject({
      type: 'table',
      shape: 'rect',
      seats: 4,
      zone: 'Mitten',
      height: 0.75,
      rotationY: 90,
    })
    expect(table?.width).toBe(1.36)
    expect(table?.depth).toBe(0.9)
  })

  it('omits grounds and fixtures, which the API cannot store', () => {
    const ids = [...toApiElements(floor).keys()]
    expect(ids).toEqual(['w-n', 'w-w', 'o-1', 't1'])
  })

  it('skips zero-length walls the API would reject as dimension <= 0', () => {
    const degenerate: Floor = {
      ...floor,
      walls: [{ id: 'w-0', dir: 'h', x: 0, y: 0, length: 0 }],
      openings: [],
    }
    expect(toApiElements(degenerate).has('w-0')).toBe(false)
  })

  it('drops an opening whose wall is gone rather than misplacing it', () => {
    const orphaned: Floor = { ...floor, walls: [], openings: floor.openings }
    expect(toApiElements(orphaned).has('o-1')).toBe(false)
  })
})

describe('API -> editor mapping', () => {
  it('round-trips walls, openings and tables back to the same geometry', () => {
    const desired = toApiElements(floor)
    const stored: LayoutElement[] = [...desired].map(([id, el]) =>
      element({ ...el, elementId: id }),
    )

    const back = toFloorElements(stored)
    expect(back.walls).toEqual(floor.walls)
    expect(back.openings[0]).toMatchObject({
      wallId: 'w-n',
      offset: 40,
      length: 60,
    })
    expect(back.tables[0]).toMatchObject({
      shape: 'square',
      seats: 4,
      zone: 'Mitten',
      x: 50,
      y: 20,
      rotation: 90,
    })
  })

  it('relabels tables by list order, since the API has no label field', () => {
    const tables = toFloorElements([
      element({ elementId: 'a', type: 'table', shape: 'round', seats: 2, zone: 'Bar' }),
      element({ elementId: 'b', type: 'table', shape: 'rect', seats: 4, zone: 'Bar' }),
    ]).tables
    expect(tables.map((t) => t.label)).toEqual(['T1', 'T2'])
  })

  it('reads every door back as an entrance — the API has no kitchen type', () => {
    const { openings } = toFloorElements([
      element({ elementId: 'w1', type: 'wall', width: 4 }),
      element({ elementId: 'd1', type: 'door', width: 1, wallId: 'w1' }),
    ])
    expect(openings[0].kind).toBe('entrance')
  })

  it('ignores an opening whose wall is missing from the response', () => {
    const { openings } = toFloorElements([
      element({ elementId: 'd1', type: 'door', wallId: 'gone' }),
    ])
    expect(openings).toEqual([])
  })
})

describe('diffLayout', () => {
  it('creates elements that have no server counterpart', () => {
    const diff = diffLayout(toApiElements(floor), [])
    expect(diff.created).toHaveLength(4)
    expect(diff.updated).toEqual([])
    expect(diff.deleted).toEqual([])
  })

  it('reports no work when local and server agree', () => {
    const desired = toApiElements(floor)
    const stored = [...desired].map(([id, el]) => element({ ...el, elementId: id }))
    const diff = diffLayout(desired, stored)
    expect(diff).toEqual({ created: [], updated: [], deleted: [] })
  })

  it('sends only the fields that changed, never the immutable type', () => {
    const desired = toApiElements(floor)
    const stored = [...desired].map(([id, el]) => element({ ...el, elementId: id }))
    const moved = new Map(desired)
    moved.set('t1', { ...desired.get('t1')!, x: 9 })

    const diff = diffLayout(moved, stored)
    expect(diff.updated).toEqual([['t1', { x: 9 }]])
    expect(diff.updated[0][1]).not.toHaveProperty('type')
  })

  it('deletes server elements the editor no longer has', () => {
    const diff = diffLayout(new Map(), [element({ elementId: 'orphan' })])
    expect(diff.deleted).toEqual(['orphan'])
  })

  it('replaces an element whose type changed, since type is immutable', () => {
    const desired = toApiElements(floor)
    const stored = [element({ elementId: 'w-n', type: 'table' })]
    const diff = diffLayout(desired, stored)
    expect(diff.deleted).toContain('w-n')
    expect(diff.created.map(([id]) => id)).toContain('w-n')
  })
})

describe('saveFloor', () => {
  it('creates walls first and rewrites a new opening to the served wall id', async () => {
    const fresh: Floor = {
      ...floor,
      walls: [{ id: 'local-wall', dir: 'h', x: 0, y: 0, length: 100 }],
      openings: [
        { id: 'local-op', kind: 'window', wallId: 'local-wall', offset: 0, length: 20 },
      ],
      tables: [],
    }
    mockedApiFetch
      .mockResolvedValueOnce({ items: [] }) // listan innan
      .mockResolvedValueOnce(element({ elementId: 'server-wall', type: 'wall' }))
      .mockResolvedValueOnce(element({ elementId: 'server-op', type: 'window' }))
      .mockResolvedValueOnce({ items: [] }) // listan efter

    await saveFloor('loc-1', fresh)

    const openingCall = mockedApiFetch.mock.calls[2]
    expect(JSON.parse(String(openingCall[1]?.body))).toMatchObject({
      type: 'window',
      wallId: 'server-wall',
    })
  })

  it('uses the location-scoped layout path', async () => {
    mockedApiFetch.mockResolvedValue({ items: [] })
    await listLayoutElements('loc 1')
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/locations/loc%201/layout-elements/items',
    )
  })
})

describe('local extras (what the API cannot store)', () => {
  it('round-trips grounds and fixtures per location', () => {
    saveLayoutExtras('loc-1', {
      grounds: floor.grounds,
      fixtures: floor.fixtures,
      doorKinds: {},
    })
    expect(loadLayoutExtras('loc-1')).toEqual({
      grounds: floor.grounds,
      fixtures: floor.fixtures,
      doorKinds: {},
    })
  })

  it('keeps locations separate', () => {
    saveLayoutExtras('loc-1', {
      grounds: floor.grounds,
      fixtures: [],
      doorKinds: {},
    })
    expect(loadLayoutExtras('loc-2')).toEqual({
      grounds: [],
      fixtures: [],
      doorKinds: {},
    })
  })

  it('treats corrupt stored data as empty instead of crashing', () => {
    localStorage.setItem('admin-layout-extras:loc-3', '{not json')
    expect(loadLayoutExtras('loc-3')).toEqual({
      grounds: [],
      fixtures: [],
      doorKinds: {},
    })
  })
})

describe('entrance vs kitchen (both stored as `door` by the API)', () => {
  it('reads a door back as a kitchen when that was recorded locally', () => {
    const { openings } = toFloorElements(
      [
        element({ elementId: 'w1', type: 'wall', width: 4 }),
        element({ elementId: 'd1', type: 'door', width: 1, wallId: 'w1' }),
      ],
      { d1: 'kitchen' },
    )
    expect(openings[0].kind).toBe('kitchen')
  })

  it('still defaults an unrecorded door to entrance', () => {
    const { openings } = toFloorElements([
      element({ elementId: 'w1', type: 'wall', width: 4 }),
      element({ elementId: 'd1', type: 'door', width: 1, wallId: 'w1' }),
    ])
    expect(openings[0].kind).toBe('entrance')
  })

  it('records door kinds but not windows, which the API can tell apart', () => {
    expect(
      toDoorKinds([
        { id: 'a', kind: 'kitchen', wallId: 'w', offset: 0, length: 20 },
        { id: 'b', kind: 'entrance', wallId: 'w', offset: 0, length: 20 },
        { id: 'c', kind: 'window', wallId: 'w', offset: 0, length: 20 },
      ]),
    ).toEqual({ a: 'kitchen', b: 'entrance' })
  })

  it('rekeys a newly created door to the id the server assigned it', () => {
    const kinds = toDoorKinds(
      [{ id: 'local-1', kind: 'kitchen', wallId: 'w', offset: 0, length: 20 }],
      new Map([['local-1', 'server-1']]),
    )
    expect(kinds).toEqual({ 'server-1': 'kitchen' })
  })
})

describe('error mapping', () => {
  it('maps 403 to a Swedish permission message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(403, 'forbidden'))
    await expect(listLayoutElements('loc-1')).rejects.toThrow(/inte behörighet/)
  })

  it('maps 503 to a try-again message', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(503, 'layout service unavailable'))
    await expect(listLayoutElements('loc-1')).rejects.toThrow(/otillgänglig/)
  })
})
