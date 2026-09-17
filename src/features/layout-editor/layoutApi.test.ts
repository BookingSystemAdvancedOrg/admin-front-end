import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import * as api from '../../shared/api'
import {
  LEGACY_FLOOR_ID,
  UNITS_PER_METER,
  activateLayoutVersion,
  diffLayout,
  listLayoutElements,
  listLayoutVersions,
  loadLayoutExtras,
  publishLayout,
  saveLayout,
  saveLayoutExtras,
  toApiElements,
  toApiLayout,
  toDoorKinds,
  toFloorElements,
  toFloors,
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

describe('floors: editor -> API', () => {
  it('emits one floor element per floor, levelled by list order, and stamps children with floorId', () => {
    const upper: Floor = {
      ...floor,
      id: 'floor-2',
      name: 'Plan 2',
      walls: [{ id: 'w-up', dir: 'h', x: 0, y: 0, length: 100 }],
      openings: [],
      tables: [],
    }
    const out = toApiLayout([floor, upper])
    expect(out.get('floor-1')).toMatchObject({ type: 'floor', name: 'Våning 1', level: 0 })
    expect(out.get('floor-2')).toMatchObject({ type: 'floor', name: 'Plan 2', level: 1 })
    expect(out.get('w-n')).toMatchObject({ type: 'wall', floorId: 'floor-1' })
    expect(out.get('t1')).toMatchObject({ type: 'table', floorId: 'floor-1' })
    expect(out.get('w-up')).toMatchObject({ type: 'wall', floorId: 'floor-2' })
  })

  it('leaves floorId out of a flat (legacy) mapping', () => {
    for (const el of toApiElements(floor).values()) {
      expect(el).not.toHaveProperty('floorId')
    }
  })
})

describe('floors: API -> editor', () => {
  const groundFloor = element({ elementId: 'f-ground', type: 'floor', name: 'Entréplan', level: 0 })
  const upperFloor = element({ elementId: 'f-upper', type: 'floor', name: 'Plan 2', level: 1 })

  it('groups elements onto their floors, ordered by level', () => {
    const floors = toFloors([
      upperFloor,
      element({ elementId: 'w-up', type: 'wall', floorId: 'f-upper' }),
      groundFloor,
      element({ elementId: 't-ground', type: 'table', floorId: 'f-ground', seats: 2 }),
    ])
    expect(floors.map((f) => [f.id, f.name])).toEqual([
      ['f-ground', 'Entréplan'],
      ['f-upper', 'Plan 2'],
    ])
    expect(floors[0].tables.map((t) => t.id)).toEqual(['t-ground'])
    expect(floors[0].walls).toEqual([])
    expect(floors[1].walls.map((w) => w.id)).toEqual(['w-up'])
  })

  it('parks elements with no or an unknown floor on the first floor', () => {
    const floors = toFloors([
      groundFloor,
      upperFloor,
      element({ elementId: 'w-orphan', type: 'wall' }),
      element({ elementId: 'w-dangling', type: 'wall', floorId: 'f-deleted' }),
    ])
    expect(floors[0].walls.map((w) => w.id)).toEqual(['w-orphan', 'w-dangling'])
    expect(floors[1].walls).toEqual([])
  })

  it('reads a flat legacy layout as a single floor with the stored extras', () => {
    const floors = toFloors([element({ elementId: 'w-1', type: 'wall' })], {
      grounds: floor.grounds,
      fixtures: floor.fixtures,
      doorKinds: {},
      byFloor: {},
    })
    expect(floors).toHaveLength(1)
    expect(floors[0].id).toBe(LEGACY_FLOOR_ID)
    expect(floors[0].grounds).toEqual(floor.grounds)
    expect(floors[0].walls.map((w) => w.id)).toEqual(['w-1'])
  })

  it('takes per-floor extras, falling back to the legacy top-level ones for the first floor', () => {
    const floors = toFloors([groundFloor, upperFloor], {
      grounds: floor.grounds,
      fixtures: [],
      doorKinds: {},
      byFloor: { 'f-upper': { grounds: [], fixtures: floor.fixtures } },
    })
    expect(floors[0].grounds).toEqual(floor.grounds)
    expect(floors[1].fixtures).toEqual(floor.fixtures)
  })
})

describe('saveLayout', () => {
  const fresh: Floor = {
    ...floor,
    walls: [{ id: 'local-wall', dir: 'h', x: 0, y: 0, length: 100 }],
    openings: [
      { id: 'local-op', kind: 'window', wallId: 'local-wall', offset: 0, length: 20 },
    ],
    tables: [],
  }

  it('creates the floor first, then walls, then openings — each rewritten to served ids', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ items: [] }) // listan innan
      .mockResolvedValueOnce(element({ elementId: 'server-floor', type: 'floor' }))
      .mockResolvedValueOnce(element({ elementId: 'server-wall', type: 'wall' }))
      .mockResolvedValueOnce(element({ elementId: 'server-op', type: 'window' }))
      .mockResolvedValueOnce({ items: [] }) // listan efter

    const result = await saveLayout('loc-1', [fresh])

    const bodies = mockedApiFetch.mock.calls.map((c) =>
      c[1]?.body ? JSON.parse(String(c[1].body)) : null,
    )
    expect(bodies[1]).toMatchObject({ type: 'floor', name: 'Våning 1', level: 0 })
    expect(bodies[2]).toMatchObject({ type: 'wall', floorId: 'server-floor' })
    expect(bodies[3]).toMatchObject({
      type: 'window',
      wallId: 'server-wall',
      floorId: 'server-floor',
    })
    expect(result.flat).toBe(false)
    expect(result.idMap.get('floor-1')).toBe('server-floor')
  })

  it('migrates a legacy flat draft: existing elements get the new floor id via update', async () => {
    const existing: Floor = {
      ...floor,
      walls: [{ id: 'old-wall', dir: 'h', x: 0, y: 0, length: 100 }],
      openings: [],
      tables: [],
    }
    mockedApiFetch
      .mockResolvedValueOnce({
        items: [
          element({ elementId: 'old-wall', type: 'wall', x: 1, z: 0, width: 2, rotationY: 0 }),
        ],
      })
      .mockResolvedValueOnce(element({ elementId: 'server-floor', type: 'floor' }))
      .mockResolvedValueOnce(element({ elementId: 'old-wall', type: 'wall' }))
      .mockResolvedValueOnce({ items: [] })

    await saveLayout('loc-1', [existing])

    const updateCall = mockedApiFetch.mock.calls[2]
    expect(updateCall[0]).toBe('/locations/loc-1/layout-elements/items/old-wall')
    expect(updateCall[1]?.method).toBe('PUT')
    expect(JSON.parse(String(updateCall[1]?.body))).toMatchObject({
      floorId: 'server-floor',
    })
  })

  it('falls back to a flat save of the first floor when the server rejects floors', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ items: [] }) // listan innan (våningsförsöket)
      .mockRejectedValueOnce(new ApiError(400, 'unsupported type floor'))
      .mockResolvedValueOnce({ items: [] }) // listan innan (platt)
      .mockResolvedValueOnce(element({ elementId: 'server-wall', type: 'wall' }))
      .mockResolvedValueOnce(element({ elementId: 'server-op', type: 'window' }))
      .mockResolvedValueOnce({ items: [] }) // listan efter

    const result = await saveLayout('loc-1', [fresh])

    expect(result.flat).toBe(true)
    const wallBody = JSON.parse(String(mockedApiFetch.mock.calls[3][1]?.body))
    expect(wallBody).toMatchObject({ type: 'wall' })
    expect(wallBody).not.toHaveProperty('floorId')
  })

  it('does not treat a permission error on the floor as missing floor support', async () => {
    mockedApiFetch
      .mockResolvedValueOnce({ items: [] })
      .mockRejectedValueOnce(new ApiError(403, 'forbidden'))
    await expect(saveLayout('loc-1', [fresh])).rejects.toThrow(/behörighet/)
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
  it('round-trips grounds and fixtures per location and per floor', () => {
    saveLayoutExtras('loc-1', {
      grounds: floor.grounds,
      fixtures: floor.fixtures,
      doorKinds: {},
      byFloor: { 'f-upper': { grounds: [], fixtures: floor.fixtures } },
    })
    expect(loadLayoutExtras('loc-1')).toEqual({
      grounds: floor.grounds,
      fixtures: floor.fixtures,
      doorKinds: {},
      byFloor: { 'f-upper': { grounds: [], fixtures: floor.fixtures } },
    })
  })

  it('keeps locations separate', () => {
    saveLayoutExtras('loc-1', {
      grounds: floor.grounds,
      fixtures: [],
      doorKinds: {},
      byFloor: {},
    })
    expect(loadLayoutExtras('loc-2')).toEqual({
      grounds: [],
      fixtures: [],
      doorKinds: {},
      byFloor: {},
    })
  })

  it('reads extras saved before floors existed (no byFloor key)', () => {
    localStorage.setItem(
      'admin-layout-extras:loc-old',
      JSON.stringify({ grounds: floor.grounds, fixtures: [], doorKinds: {} }),
    )
    expect(loadLayoutExtras('loc-old')).toEqual({
      grounds: floor.grounds,
      fixtures: [],
      doorKinds: {},
      byFloor: {},
    })
  })

  it('treats corrupt stored data as empty instead of crashing', () => {
    localStorage.setItem('admin-layout-extras:loc-3', '{not json')
    expect(loadLayoutExtras('loc-3')).toEqual({
      grounds: [],
      fixtures: [],
      doorKinds: {},
      byFloor: {},
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

describe('publishing', () => {
  it('POSTs to layout/publish with no body — the API numbers the version', async () => {
    mockedApiFetch.mockResolvedValue({ version: 1, label: 'Version 1', elements: [] })
    const snapshot = await publishLayout('loc-1')
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/locations/loc-1/layout/publish',
      { method: 'POST' },
    )
    expect(snapshot.version).toBe(1)
  })

  it('lists versions newest first, unwrapping the items envelope', async () => {
    mockedApiFetch.mockResolvedValue({
      items: [
        { version: 2, label: 'Version 2', elements: [] },
        { version: 1, label: 'Version 1', elements: [] },
      ],
    })
    const versions = await listLayoutVersions('loc-1')
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(mockedApiFetch).toHaveBeenCalledWith('/locations/loc-1/layout/versions')
  })

  it('treats a location with no published versions as an empty list', async () => {
    mockedApiFetch.mockResolvedValue({ items: [] })
    expect(await listLayoutVersions('loc-1')).toEqual([])
  })

  it('activates a version with no body, on the numbered path', async () => {
    mockedApiFetch.mockResolvedValue({
      status: 'active',
      version: 1,
      effectiveFrom: '2026-09-10T10:00:00Z',
    })
    const res = await activateLayoutVersion('loc-1', 1)
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/locations/loc-1/layout/versions/1/activate',
      { method: 'POST' },
    )
    expect(res.status).toBe('active')
  })

  it('reports a scheduled cutover rather than pretending the switch happened', async () => {
    mockedApiFetch.mockResolvedValue({
      status: 'pending',
      version: 2,
      currentVersion: 1,
      cutoverAt: '2026-10-08T01:00:00Z',
    })
    const res = await activateLayoutVersion('loc-1', 2)
    expect(res).toMatchObject({
      status: 'pending',
      currentVersion: 1,
      cutoverAt: '2026-10-08T01:00:00Z',
    })
  })

  it('explains a 409 as a pending cutover, not a concurrent edit', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(409, 'cutover pending'))
    await expect(activateLayoutVersion('loc-1', 3)).rejects.toThrow(
      /versionsbyte är redan inbokat/,
    )
  })

  it('maps 403 on activate to the permission message (staff may not activate)', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(403, 'forbidden'))
    await expect(activateLayoutVersion('loc-1', 1)).rejects.toThrow(
      /inte behörighet/,
    )
  })

  it('maps 403 on publish to the permission message (staff may not publish)', async () => {
    mockedApiFetch.mockRejectedValue(new ApiError(403, 'forbidden'))
    await expect(publishLayout('loc-1')).rejects.toThrow(/inte behörighet/)
  })

  it('URL-encodes the location id', async () => {
    mockedApiFetch.mockResolvedValue({ items: [] })
    await listLayoutVersions('loc 1')
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/locations/loc%201/layout/versions',
    )
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
