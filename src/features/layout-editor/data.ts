/**
 * Typer och konstanter för golvplanen. Datan kommer från backend via
 * `layoutApi.ts` - det finns medvetet ingen mockplan här längre, eftersom
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
  /**
   * Bordets mått i golvenheter. Satta manuellt via resize-handtagen (dra en
   * sida eller ände) - inte längre härledda ur form/antal platser, så ett
   * "fyrkantigt" bord kan göras till en avlång rektangel. `defaultTableSize`
   * ger bara ett rimligt startförslag när bordet skapas.
   */
  w: number
  h: number
}

/**
 * En vägg längs rutnätet. Väggar är alltid hela - öppningar (fönster,
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

/** En ritad markyta - golvet byggs av en eller flera sådana rektanglar. */
export interface GroundRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** En våning. Nya våningar börjar helt tomma - marken ritas först. */
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

/** En ny, helt tom våning - marken ritas först med Mark-verktyget. */
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

/**
 * Förslag på bordsyta utifrån form och antal platser - används bara som
 * startvärde när ett nytt bord skapas. Storleken är annars fri och styrs av
 * användaren via resize-handtagen (se `tableSize`).
 */
export function defaultTableSize(
  shape: TableShape,
  seats: number,
): { w: number; h: number } {
  if (shape === 'round') {
    const d = 44 + Math.min(seats, 10) * 4
    return { w: d, h: d }
  }
  const w = 48 + Math.min(seats, 12) * 5
  return { w, h: Math.round(w * 0.66) }
}

/** Bordets faktiska yta i golvenheter - en bekväm genväg för { w, h }. */
export function tableSize(t: Pick<TableElement, 'w' | 'h'>): {
  w: number
  h: number
} {
  return { w: t.w, h: t.h }
}

/** Minsta tillåtna bordsmått vid manuell storleksändring. */
export const MIN_TABLE_SIZE = 24

/** Stolens storlek i golvenheter: bredd längs bordskanten, djup ut från bordet. */
export const SEAT_W = 20
export const SEAT_D = 17

/** Så långt stolen är inskjuten under bordsskivan (golvenheter). */
export const SEAT_TUCK = 8

/** Stolens mitt räknat från bordskanten: inskjuten, så den syns "intryckt". */
const SEAT_OUT = SEAT_D / 2 - SEAT_TUCK

/**
 * Stolarnas mittpunkter, relativt bordets mitt, en per plats, och vridningen
 * (0 = ryggstödet uppåt). Runda bord får dem jämnt fördelade i en cirkel;
 * fyrkantiga längs långsidorna, så att ett fyrsitsigt bord får två mitt emot
 * två, och på kortsidorna bara när långsidorna inte räcker.
 */
export function seatPositions(
  t: Pick<TableElement, 'shape' | 'seats' | 'w' | 'h'>,
): { x: number; y: number; rot: number }[] {
  const n = Math.max(0, Math.round(t.seats))
  if (n === 0) return []
  const size = tableSize(t)
  const out: { x: number; y: number; rot: number }[] = []

  if (t.shape === 'round') {
    const r = size.w / 2 + SEAT_OUT
    for (let i = 0; i < n; i++) {
      // Börja rakt uppåt och gå medurs. Ryggstödet vänder bort från bordet.
      const a = (i / n) * 2 * Math.PI - Math.PI / 2
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, rot: (a * 180) / Math.PI + 90 })
    }
    return out
  }

  // Längs långsidorna (lika många på varje sida), och en på varje kortsida
  // bara när de inte får plats - samma regel som gästens planritning.
  const long = size.w >= size.h
  const along = long ? size.w : size.h
  const across = long ? size.h : size.w
  const ends = Math.ceil(n / 2) * (SEAT_W + 4) > along && n >= 4 ? 2 : 0
  const top = Math.ceil((n - ends) / 2)
  const bottom = n - ends - top
  const place = (count: number, sign: number) => {
    for (let i = 0; i < count; i++) {
      const u = ((i + 0.5) / count - 0.5) * along
      const v = sign * (across / 2 + SEAT_OUT)
      out.push(long ? { x: u, y: v, rot: sign > 0 ? 180 : 0 } : { x: v, y: u, rot: sign > 0 ? 90 : 270 })
    }
  }
  place(top, -1)
  place(bottom, 1)
  for (let i = 0; i < ends; i++) {
    const sign = i === 0 ? -1 : 1
    const u = sign * (along / 2 + SEAT_OUT)
    out.push(long ? { x: u, y: 0, rot: sign > 0 ? 90 : 270 } : { x: 0, y: u, rot: sign > 0 ? 180 : 0 })
  }
  return out
}
