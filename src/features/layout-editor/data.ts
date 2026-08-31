/**
 * Typer och konstanter för golvplanen. Datan kommer från backend via
 * `layoutApi.ts` — det finns medvetet ingen mockplan här längre, eftersom
 * den hann visas ett ögonblick innan den riktiga layouten lästs in.
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

/** Stolens storlek i golvenheter. */
export const SEAT_SIZE = 13

/** Hur långt ut från bordskanten stolen ställs. */
const SEAT_GAP = 4

/**
 * Stolarnas mittpunkter, relativt bordets mitt, en per plats. Runda bord får
 * dem jämnt fördelade i en cirkel; fyrkantiga längs kanterna, med start mitt
 * på ovansidan så att ett fyrsitsigt bord får två mitt emot varandra istället
 * för fyra i hörnen.
 */
export function seatPositions(
  t: Pick<TableElement, 'shape' | 'seats'>,
): { x: number; y: number }[] {
  const n = Math.max(0, Math.round(t.seats))
  if (n === 0) return []
  const size = tableSize(t)
  const out: { x: number; y: number }[] = []

  if (t.shape === 'round') {
    const r = size.w / 2 + SEAT_GAP + SEAT_SIZE / 2
    for (let i = 0; i < n; i++) {
      // Börja rakt uppåt och gå medurs.
      const a = (i / n) * 2 * Math.PI - Math.PI / 2
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
    }
    return out
  }

  const halfW = size.w / 2 + SEAT_GAP + SEAT_SIZE / 2
  const halfH = size.h / 2 + SEAT_GAP + SEAT_SIZE / 2
  const perimeter = 2 * (size.w + size.h)
  for (let i = 0; i < n; i++) {
    // Gå runt bordets omkrets, med en halv lucka i början så att stolarna
    // hamnar mitt på kanterna och inte i hörnen.
    const d = ((i + 0.5) / n) * perimeter
    if (d < size.w) {
      out.push({ x: d - size.w / 2, y: -halfH })
    } else if (d < size.w + size.h) {
      out.push({ x: halfW, y: d - size.w - size.h / 2 })
    } else if (d < 2 * size.w + size.h) {
      out.push({ x: size.w / 2 - (d - size.w - size.h), y: halfH })
    } else {
      out.push({ x: -halfW, y: size.h / 2 - (d - 2 * size.w - size.h) })
    }
  }
  return out
}
