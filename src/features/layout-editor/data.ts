/**
 * MOCKDATA — golvplanen ersätts med backend-anrop när API:t är på plats:
 *   const layout = await apiFetch<FloorLayout>('/layout')
 *   await apiFetch('/layout', { method: 'PUT', body: JSON.stringify(layout) })
 * (se src/shared/api.ts och docs/BACKEND-KOPPLING.md)
 */

export type TableShape = 'square' | 'round'

export interface TableElement {
  id: string
  label: string
  shape: TableShape
  seats: number
  zone: string
  /** Position i origo-koordinater (0,0 = canvasens mitt). */
  x: number
  y: number
  rotation: number
}

/**
 * En vägg längs rutnätet. Väggar är alltid hela — öppningar (fönster,
 * entré, kökets ingång) ligger SOM PÅBYGGNAD på väggen (se Opening) och
 * klipper aldrig hål i den. När en markyta ritas skapas väggar runt om
 * den automatiskt.
 */
export interface WallSegment {
  id: string
  /** 'h' = vågrätt, 'v' = lodrätt. */
  dir: 'h' | 'v'
  /** Startpunkt (vänster/övre änden). */
  x: number
  y: number
  length: number
}

/**
 * En öppning fastsatt på en vägg: fönster, entré eller kökets ingång.
 * `offset` är avståndet från väggens start längs väggen. Flyttas eller
 * förlängs väggen följer öppningen med; öppningen kan själv glida längs
 * väggen och storleksändras, men aldrig lämna den.
 */
export type OpeningKind = 'window' | 'entrance' | 'kitchen'

export interface Opening {
  id: string
  kind: OpeningKind
  wallId: string
  offset: number
  length: number
}

/** Fasta inventarier på golvet, t.ex. kassan. */
export interface Fixture {
  id: string
  type: 'counter'
  label: string
  x: number
  y: number
  w: number
  h: number
}

/** En ritad markyta — golvet byggs av en eller flera sådana rektanglar. */
export interface GroundRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** En våning. Nya våningar börjar helt tomma — marken ritas först. */
export interface Floor {
  id: string
  name: string
  grounds: GroundRect[]
  walls: WallSegment[]
  openings: Opening[]
  fixtures: Fixture[]
  tables: TableElement[]
}

export interface FloorLayout {
  version: number
  publishedLabel: string
  floors: Floor[]
}

export const ZONES = ['Fönsterbord', 'Mitten', 'Bar', 'Entré'] as const

export const OPENING_LABEL: Record<OpeningKind, string> = {
  window: 'Fönster',
  entrance: 'Entré',
  kitchen: 'Kökets ingång',
}

/** Rutnätssteg som allt byggande snappar till. */
export const GRID = 20

/** Arbetsytans storlek. Origo (0,0) ligger i canvasens mitt. */
export const WORKSPACE = { w: 1200, h: 900 }

/** Basmarkens läge på våning 1 — centrerad kring origo. */
const GX = -280
const GY = -180

export const MOCK_LAYOUT: FloorLayout = {
  version: 4,
  publishedLabel: 'Publicerad 12 aug',
  floors: [
    {
      id: 'floor-1',
      name: 'Våning 1',
      grounds: [{ id: 'g1', x: GX, y: GY, w: 560, h: 360 }],
      // Hela väggar runt marken — öppningarna sitter PÅ väggarna nedan.
      walls: [
        { id: 'w-n', dir: 'h', x: GX, y: GY, length: 560 },
        { id: 'w-s', dir: 'h', x: GX, y: GY + 360, length: 560 },
        { id: 'w-w', dir: 'v', x: GX, y: GY, length: 360 },
        { id: 'w-e', dir: 'v', x: GX + 560, y: GY, length: 360 },
      ],
      openings: [
        { id: 'o-window', kind: 'window', wallId: 'w-n', offset: 120, length: 140 },
        { id: 'o-kitchen', kind: 'kitchen', wallId: 'w-e', offset: 60, length: 80 },
        { id: 'o-entrance', kind: 'entrance', wallId: 'w-s', offset: 220, length: 120 },
      ],
      fixtures: [
        { id: 'f-kassa', type: 'counter', label: 'KASSA', x: GX + 478, y: GY + 290, w: 100, h: 36 },
      ],
      tables: [
        { id: 't1', label: 'T1', shape: 'square', seats: 4, zone: 'Fönsterbord', x: GX + 80, y: GY + 52, rotation: 0 },
        { id: 't2', label: 'T2', shape: 'round', seats: 2, zone: 'Fönsterbord', x: GX + 170, y: GY + 84, rotation: 0 },
        { id: 't3', label: 'T3', shape: 'square', seats: 6, zone: 'Fönsterbord', x: GX + 262, y: GY + 118, rotation: 0 },
        { id: 't4', label: 'T4', shape: 'round', seats: 2, zone: 'Mitten', x: GX + 356, y: GY + 152, rotation: 0 },
        { id: 't5', label: 'T5', shape: 'square', seats: 4, zone: 'Mitten', x: GX + 442, y: GY + 190, rotation: 0 },
        { id: 't6', label: 'T6', shape: 'round', seats: 2, zone: 'Bar', x: GX + 508, y: GY + 224, rotation: 0 },
        { id: 't7', label: 'T7', shape: 'square', seats: 4, zone: 'Fönsterbord', x: GX + 96, y: GY + 142, rotation: 0 },
        { id: 't8', label: 'T8', shape: 'square', seats: 8, zone: 'Mitten', x: GX + 196, y: GY + 182, rotation: 0 },
        { id: 't9', label: 'T9', shape: 'round', seats: 2, zone: 'Mitten', x: GX + 292, y: GY + 216, rotation: 0 },
        { id: 't10', label: 'T10', shape: 'square', seats: 4, zone: 'Mitten', x: GX + 372, y: GY + 262, rotation: 0 },
        { id: 't11', label: 'T11', shape: 'square', seats: 4, zone: 'Fönsterbord', x: GX + 66, y: GY + 232, rotation: 0 },
        { id: 't12', label: 'T12', shape: 'round', seats: 2, zone: 'Bar', x: GX + 160, y: GY + 268, rotation: 0 },
        { id: 't13', label: 'T13', shape: 'square', seats: 4, zone: 'Entré', x: GX + 248, y: GY + 302, rotation: 0 },
      ],
    },
  ],
}

/** En ny, helt tom våning — marken ritas först med Mark-verktyget. */
export function emptyFloor(n: number): Floor {
  return {
    id: `floor-${n}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Våning ${n}`,
    grounds: [],
    walls: [],
    openings: [],
    fixtures: [],
    tables: [],
  }
}

/** Bordets yta i golvenheter utifrån form och antal platser. */
export function tableSize(t: Pick<TableElement, 'shape' | 'seats'>): {
  w: number
  h: number
} {
  if (t.shape === 'round') {
    const d = 44 + Math.min(t.seats, 10) * 4
    return { w: d, h: d }
  }
  const w = 48 + Math.min(t.seats, 12) * 5
  return { w, h: Math.round(w * 0.66) }
}
