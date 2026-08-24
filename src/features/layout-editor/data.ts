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
  /** Position i arbetsytans koordinater (0,0 = övre vänstra hörnet). */
  x: number
  y: number
  rotation: number
}

/**
 * Segment som byggs längs rutnätet: hela väggar, fönster (glas i väggen),
 * entrén och kökets ingång. Ritas med respektive verktyg.
 */
export type SegmentKind = 'wall' | 'window' | 'entrance' | 'kitchen'

export interface WallSegment {
  id: string
  kind: SegmentKind
  /** 'h' = vågrätt, 'v' = lodrätt. */
  dir: 'h' | 'v'
  /** Startpunkt (vänster/övre änden). */
  x: number
  y: number
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
  segments: WallSegment[]
  fixtures: Fixture[]
  tables: TableElement[]
}

export interface FloorLayout {
  version: number
  publishedLabel: string
  floors: Floor[]
}

export const ZONES = ['Fönsterbord', 'Mitten', 'Bar', 'Entré'] as const

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  wall: 'Vägg',
  window: 'Fönster',
  entrance: 'Entré',
  kitchen: 'Kökets ingång',
}

/** Rutnätssteg som allt byggande snappar till. */
export const GRID = 20

/** Arbetsytans storlek — marken ritas fritt inom den här ytan. Vyn zoomar
 * automatiskt så att allt ritat får plats i canvasen.
 * Koordinatsystemet har origo (0,0) i canvasens MITT: x och y går från
 * -w/2..w/2 respektive -h/2..h/2, och allt byggande utgår från mitten. */
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
      segments: [
        // Norra väggen med fönsterparti
        { id: 'w-n1', kind: 'wall', dir: 'h', x: GX, y: GY, length: 120 },
        { id: 'w-n2', kind: 'window', dir: 'h', x: GX + 120, y: GY, length: 140 },
        { id: 'w-n3', kind: 'wall', dir: 'h', x: GX + 260, y: GY, length: 300 },
        // Västra väggen
        { id: 'w-w1', kind: 'wall', dir: 'v', x: GX, y: GY, length: 360 },
        // Östra väggen med kökets ingång
        { id: 'w-e1', kind: 'wall', dir: 'v', x: GX + 560, y: GY, length: 60 },
        { id: 'w-e2', kind: 'kitchen', dir: 'v', x: GX + 560, y: GY + 60, length: 80 },
        { id: 'w-e3', kind: 'wall', dir: 'v', x: GX + 560, y: GY + 140, length: 220 },
        // Södra väggen med entré-öppning
        { id: 'w-s1', kind: 'wall', dir: 'h', x: GX, y: GY + 360, length: 220 },
        { id: 'w-s2', kind: 'entrance', dir: 'h', x: GX + 220, y: GY + 360, length: 120 },
        { id: 'w-s3', kind: 'wall', dir: 'h', x: GX + 340, y: GY + 360, length: 220 },
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
    segments: [],
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
