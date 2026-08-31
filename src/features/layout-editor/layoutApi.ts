import { apiFetch, ApiError } from '../../shared/api'
import { tableSize } from './data'
import type {
  Floor,
  Opening,
  OpeningKind,
  TableElement,
  WallSegment,
} from './data'

/**
 * Klient mot backendens /locations/{id}/layout-elements/*-endpoints.
 *
 * API:t lagrar en PLATT lista av 3D-element (wall/door/window/table) med
 * meter som enhet, medan editorn arbetar i 2D-rutnätsenheter med våningar,
 * markytor och inventarier. Den här filen är översättningen mellan de två
 * modellerna — se `toApiElements`/`toFloorElements`.
 *
 * Vad som INTE går att spara (API:ts datamodell saknar fälten helt, och
 * alla scheman är `additionalProperties: false` så det finns ingen plats
 * att gömma dem i):
 *   - markytor (grounds) och inventarier som kassan (fixtures) — spec:en
 *     säger uttryckligen "`decor` is not supported by the current data model"
 *   - flera våningar — listan är per plats, inte per våning
 *   - bordens etiketter (T1, T2 …) — återskapas vid inläsning
 *   - skillnaden entré/kökets ingång — båda lagras som `door`
 */

export type ApiElementType = 'wall' | 'door' | 'window' | 'table'

export interface LayoutElement {
  elementId: string
  type: ApiElementType
  x: number
  y: number
  z: number
  width: number
  height: number
  depth: number
  rotationY: number
  shape?: 'rect' | 'round'
  seats?: number
  zone?: string
  wallId?: string
  updatedBy: string
  updatedAt: string
}

/** Ett komplett element utan de fält API:t själv sätter. */
export type LayoutElementCreate = Omit<
  LayoutElement,
  'elementId' | 'updatedBy' | 'updatedAt'
>

/** Strikt partiell uppdatering. `type` är immutabelt och skickas aldrig. */
export type LayoutElementUpdate = Partial<Omit<LayoutElementCreate, 'type'>>

/**
 * Editor-enheter per meter. Ett fyrsitsigt fyrkantsbord blir 68×45 enheter
 * ≈ 1.36×0.90 m, vilket matchar exempelbordet i spec:en (1.4×0.9) — så
 * skalan är vald för att stämma med backendens verklighetsuppfattning.
 */
export const UNITS_PER_METER = 50

/** Höjder i meter. Editorns 2D-vy har ingen höjd, så de är konstanta. */
const TABLE_HEIGHT_M = 0.75
const WALL_HEIGHT_M = 1.8
const WALL_THICKNESS_M = 0.2
const DOOR_HEIGHT_M = 2
const WINDOW_HEIGHT_M = 1.2
/** Fönstrets underkant över golvet. */
const WINDOW_SILL_M = 1
const OPENING_THICKNESS_M = 0.28

const toM = (units: number): number => round(units / UNITS_PER_METER)
const toUnits = (meters: number): number => meters * UNITS_PER_METER

/** Fyra decimaler räcker på millimeternivå och håller diffen fri från flyttalsbrus. */
function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

/* --- Editor -> API ------------------------------------------------------- */

function wallToApi(w: WallSegment): LayoutElementCreate {
  const horizontal = w.dir === 'h'
  return {
    type: 'wall',
    // API:t placerar elementets mittpunkt, editorn väggens startpunkt.
    x: toM(horizontal ? w.x + w.length / 2 : w.x),
    y: 0,
    z: toM(horizontal ? w.y : w.y + w.length / 2),
    width: toM(w.length),
    height: WALL_HEIGHT_M,
    depth: WALL_THICKNESS_M,
    rotationY: horizontal ? 0 : 90,
  }
}

function openingToApi(
  o: Opening,
  wall: WallSegment,
): LayoutElementCreate | null {
  if (o.length <= 0) return null
  const horizontal = wall.dir === 'h'
  // Öppningens mittpunkt räknad från väggens start längs väggen.
  const along = o.offset + o.length / 2
  const isWindow = o.kind === 'window'
  return {
    // Entré och kökets ingång är båda dörrar i API:t — skillnaden finns inte
    // i datamodellen och går därför inte att läsa tillbaka.
    type: isWindow ? 'window' : 'door',
    x: toM(horizontal ? wall.x + along : wall.x),
    y: isWindow ? WINDOW_SILL_M : 0,
    z: toM(horizontal ? wall.y : wall.y + along),
    width: toM(o.length),
    height: isWindow ? WINDOW_HEIGHT_M : DOOR_HEIGHT_M,
    depth: OPENING_THICKNESS_M,
    rotationY: horizontal ? 0 : 90,
    wallId: o.wallId,
  }
}

function tableToApi(t: TableElement): LayoutElementCreate {
  // Måtten härleds ur form + antal platser, så de behöver aldrig läsas
  // tillbaka — `tableSize` ger samma svar på båda sidor av rundturen.
  const size = tableSize(t)
  return {
    type: 'table',
    x: toM(t.x),
    y: 0,
    z: toM(t.y),
    width: toM(size.w),
    height: TABLE_HEIGHT_M,
    depth: toM(size.h),
    rotationY: t.rotation,
    shape: t.shape === 'round' ? 'round' : 'rect',
    seats: Math.max(1, Math.round(t.seats)),
    zone: t.zone.trim() || 'Ospecificerad',
  }
}

/**
 * Översätter en våning till API-element, nycklade på editorns lokala id så
 * att diffen mot serverns lista kan matcha ihop dem. Element utan giltig
 * geometri (nollängd) utelämnas — API:t kräver dimensioner > 0.
 */
export function toApiElements(floor: Floor): Map<string, LayoutElementCreate> {
  const out = new Map<string, LayoutElementCreate>()
  const wallById = new Map(floor.walls.map((w) => [w.id, w]))

  for (const w of floor.walls) {
    if (w.length > 0) out.set(w.id, wallToApi(w))
  }
  for (const o of floor.openings) {
    const wall = wallById.get(o.wallId)
    if (!wall) continue
    const el = openingToApi(o, wall)
    if (el) out.set(o.id, el)
  }
  for (const t of floor.tables) {
    out.set(t.id, tableToApi(t))
  }
  return out
}

/* --- API -> Editor ------------------------------------------------------- */

/** Vågrät om rotationen ligger närmare 0° än 90° (modulo 180°). */
function isHorizontal(rotationY: number): boolean {
  const a = ((rotationY % 180) + 180) % 180
  return a < 45 || a >= 135
}

function wallFromApi(el: LayoutElement): WallSegment {
  const horizontal = isHorizontal(el.rotationY)
  const length = toUnits(el.width)
  const cx = toUnits(el.x)
  const cz = toUnits(el.z)
  return {
    id: el.elementId,
    dir: horizontal ? 'h' : 'v',
    x: horizontal ? cx - length / 2 : cx,
    y: horizontal ? cz : cz - length / 2,
    length,
  }
}

function openingFromApi(
  el: LayoutElement,
  wall: WallSegment,
  doorKinds: Record<string, OpeningKind>,
): Opening {
  const length = toUnits(el.width)
  const along = wall.dir === 'h' ? toUnits(el.x) - wall.x : toUnits(el.z) - wall.y
  // API:t lagrar entré och kök som samma `door`. Den lokalt sparade
  // dörrtypen avgör vilken det var; utan den blir en dörr en entré.
  const stored = doorKinds[el.elementId]
  const kind: OpeningKind =
    el.type === 'window'
      ? 'window'
      : stored === 'kitchen' || stored === 'entrance'
        ? stored
        : 'entrance'
  return {
    id: el.elementId,
    kind,
    wallId: wall.id,
    offset: Math.max(0, along - length / 2),
    length,
  }
}

function tableFromApi(el: LayoutElement, index: number): TableElement {
  return {
    id: el.elementId,
    // Etiketten finns inte i API:t — numrera om efter listans ordning.
    label: `T${index + 1}`,
    shape: el.shape === 'round' ? 'round' : 'square',
    seats: el.seats ?? 2,
    zone: el.zone ?? '',
    x: toUnits(el.x),
    y: toUnits(el.z),
    rotation: el.rotationY,
  }
}

/**
 * Bygger våningens element ur API-listan. Markytor och inventarier blir
 * tomma — de finns inte i API:t.
 */
export function toFloorElements(
  elements: LayoutElement[],
  doorKinds: Record<string, OpeningKind> = {},
): Pick<Floor, 'walls' | 'openings' | 'tables'> {
  const walls = elements.filter((e) => e.type === 'wall').map(wallFromApi)
  const wallById = new Map(walls.map((w) => [w.id, w]))

  const openings: Opening[] = []
  for (const el of elements) {
    if (el.type !== 'door' && el.type !== 'window') continue
    // En öppning utan sin vägg går inte att placera - API:t garanterar
    // ingen relation, så den hoppas över istället för att hamna fel.
    const wall = el.wallId ? wallById.get(el.wallId) : undefined
    if (wall) openings.push(openingFromApi(el, wall, doorKinds))
  }

  const tables = elements
    .filter((e) => e.type === 'table')
    .map((el, i) => tableFromApi(el, i))

  return { walls, openings, tables }
}

/* --- Lokalt sparat (det API:t inte kan lagra) ---------------------------- */

const LOCAL_EXTRAS_KEY = 'admin-layout-extras'

/**
 * Det API:t inte kan lagra — se filhuvudet. Utöver markytor och inventarier
 * ingår `doorKinds`: en karta elementId -> 'entrance' | 'kitchen', eftersom
 * API:t lagrar båda som `door` och annars läser tillbaka varje kök som en
 * entré.
 */
export interface LayoutExtras extends Pick<Floor, 'grounds' | 'fixtures'> {
  doorKinds: Record<string, OpeningKind>
}

const EMPTY_EXTRAS: LayoutExtras = { grounds: [], fixtures: [], doorKinds: {} }

/**
 * Sparar det API:t inte kan lagra i webbläsaren, per plats. Det är en
 * nödlösning tills backend stödjer markytor och inventarier: kassan och
 * golvytan överlever en omladdning, men bara på den här datorn och syns
 * inte för kollegor. Backend behöver egna elementtyper för att lösa det.
 */
export function loadLayoutExtras(locationId: string): LayoutExtras {
  try {
    const raw = localStorage.getItem(`${LOCAL_EXTRAS_KEY}:${locationId}`)
    if (!raw) return EMPTY_EXTRAS
    const parsed = JSON.parse(raw) as Partial<LayoutExtras>
    return {
      grounds: Array.isArray(parsed.grounds) ? parsed.grounds : [],
      fixtures: Array.isArray(parsed.fixtures) ? parsed.fixtures : [],
      doorKinds:
        parsed.doorKinds && typeof parsed.doorKinds === 'object'
          ? parsed.doorKinds
          : {},
    }
  } catch {
    return EMPTY_EXTRAS
  }
}

export function saveLayoutExtras(
  locationId: string,
  extras: LayoutExtras,
): void {
  try {
    localStorage.setItem(
      `${LOCAL_EXTRAS_KEY}:${locationId}`,
      JSON.stringify({
        grounds: extras.grounds,
        fixtures: extras.fixtures,
        doorKinds: extras.doorKinds,
      }),
    )
  } catch {
    // Full eller avstängd localStorage ska inte krascha editorn.
  }
}

/* --- HTTP ---------------------------------------------------------------- */

function basePath(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/layout-elements/items`
}

/** Mappar API:ts fel till svenska meddelanden, som usersApi/locationApi. */
function toFriendlyLayoutError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Ett okänt fel inträffade.')
  }
  console.error(`[Layout] ${err.status}: ${err.message}`)

  switch (err.status) {
    case 400:
      return new Error(`Layouten avvisades av servern: ${err.message}`)
    case 401:
      return new Error('Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new Error('Du har inte behörighet att ändra layouten.')
    case 404:
      return new Error('Elementet finns inte längre — ladda om sidan.')
    case 409:
      return new Error(
        'Layouten ändrades samtidigt av någon annan. Ladda om och försök igen.',
      )
    case 503:
      return new Error('Layouttjänsten är tillfälligt otillgänglig. Försök igen.')
    default:
      return new Error(err.message || `Serverfel (${err.status}).`)
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toFriendlyLayoutError(err)
  }
}

export function listLayoutElements(locationId: string): Promise<LayoutElement[]> {
  return call(async () => {
    const res = await apiFetch<{ items?: LayoutElement[] }>(basePath(locationId))
    return res.items ?? []
  })
}

export function createLayoutElement(
  locationId: string,
  element: LayoutElementCreate,
): Promise<LayoutElement> {
  return call(() =>
    apiFetch<LayoutElement>(basePath(locationId), {
      method: 'POST',
      body: JSON.stringify(element),
    }),
  )
}

export function updateLayoutElement(
  locationId: string,
  elementId: string,
  updates: LayoutElementUpdate,
): Promise<LayoutElement> {
  return call(() =>
    apiFetch<LayoutElement>(
      `${basePath(locationId)}/${encodeURIComponent(elementId)}`,
      { method: 'PUT', body: JSON.stringify(updates) },
    ),
  )
}

export function deleteLayoutElement(
  locationId: string,
  elementId: string,
): Promise<void> {
  return call(() =>
    apiFetch<void>(`${basePath(locationId)}/${encodeURIComponent(elementId)}`, {
      method: 'DELETE',
    }),
  )
}

/* --- Synkronisering ------------------------------------------------------ */

export interface LayoutDiff {
  created: [string, LayoutElementCreate][]
  updated: [string, LayoutElementUpdate][]
  deleted: string[]
}

/** Fälten som får ingå i en PUT (allt utom det immutabla `type`). */
const UPDATABLE_FIELDS = [
  'x',
  'y',
  'z',
  'width',
  'height',
  'depth',
  'rotationY',
  'shape',
  'seats',
  'zone',
  'wallId',
] as const

function changedFields(
  desired: LayoutElementCreate,
  stored: LayoutElement,
): LayoutElementUpdate {
  const updates: Record<string, unknown> = {}
  for (const key of UPDATABLE_FIELDS) {
    const next = desired[key]
    if (next === undefined) continue
    const prev = stored[key]
    const same =
      typeof next === 'number' && typeof prev === 'number'
        ? Math.abs(next - prev) < 1e-6
        : next === prev
    if (!same) updates[key] = next
  }
  return updates as LayoutElementUpdate
}

/**
 * Jämför våningens element mot serverns lista. Editorns lokala id är samma
 * som `elementId` för allt som lästs in från API:t, så nya element (med
 * lokalt genererade id:n) hamnar i `created` och borttagna i `deleted`.
 */
export function diffLayout(
  desired: Map<string, LayoutElementCreate>,
  stored: LayoutElement[],
): LayoutDiff {
  const storedById = new Map(stored.map((e) => [e.elementId, e]))
  const diff: LayoutDiff = { created: [], updated: [], deleted: [] }

  for (const [localId, element] of desired) {
    const existing = storedById.get(localId)
    if (!existing) {
      diff.created.push([localId, element])
      continue
    }
    // Typbyte går inte att uppdatera - elementet måste ersättas.
    if (existing.type !== element.type) {
      diff.deleted.push(localId)
      diff.created.push([localId, element])
      continue
    }
    const updates = changedFields(element, existing)
    if (Object.keys(updates).length > 0) diff.updated.push([localId, updates])
  }

  for (const el of stored) {
    if (!desired.has(el.elementId)) diff.deleted.push(el.elementId)
  }
  return diff
}

export interface LayoutSaveResult {
  created: number
  updated: number
  deleted: number
  /** Serverns lista efter sparandet — används för att läsa in våningen igen. */
  elements: LayoutElement[]
  /**
   * Lokalt id -> serverns elementId för allt som just skapades. Behövs för
   * att kunna föra över lokalt lagrade egenskaper (t.ex. om en dörr är
   * entré eller kök) till det id servern nu använder.
   */
  idMap: Map<string, string>
}

/**
 * Sparar våningen: hämtar serverns nuvarande lista, räknar ut skillnaden och
 * kör de anrop som behövs.
 *
 * Väggar skapas först och deras nya `elementId` samlas upp, eftersom en ny
 * dörr/fönster bär väggens LOKALA id i `wallId` — det måste bytas mot
 * serverns id innan öppningen skapas, annars pekar den ut i tomma intet.
 */
export async function saveFloor(
  locationId: string,
  floor: Floor,
): Promise<LayoutSaveResult> {
  const desired = toApiElements(floor)
  const stored = await listLayoutElements(locationId)
  const diff = diffLayout(desired, stored)

  for (const elementId of diff.deleted) {
    await deleteLayoutElement(locationId, elementId)
  }

  // Lokalt id -> serverns elementId för allt som just skapats.
  const idMap = new Map<string, string>()
  const walls = diff.created.filter(([, el]) => el.type === 'wall')
  const rest = diff.created.filter(([, el]) => el.type !== 'wall')

  for (const [localId, element] of walls) {
    const saved = await createLayoutElement(locationId, element)
    idMap.set(localId, saved.elementId)
  }
  for (const [localId, element] of rest) {
    const saved = await createLayoutElement(
      locationId,
      withMappedWallId(element, idMap),
    )
    idMap.set(localId, saved.elementId)
  }
  for (const [elementId, updates] of diff.updated) {
    await updateLayoutElement(
      locationId,
      elementId,
      withMappedWallId(updates, idMap),
    )
  }

  return {
    created: diff.created.length,
    updated: diff.updated.length,
    deleted: diff.deleted.length,
    elements: await listLayoutElements(locationId),
    idMap,
  }
}

/**
 * Bygger kartan elementId -> dörrtyp som ska sparas lokalt, med lokala id:n
 * översatta till serverns efter en sparning. Fönster tas inte med — de har
 * en egen typ i API:t och behöver ingen lokal notering.
 */
export function toDoorKinds(
  openings: Opening[],
  idMap: Map<string, string> = new Map(),
): Record<string, OpeningKind> {
  const out: Record<string, OpeningKind> = {}
  for (const o of openings) {
    if (o.kind === 'window') continue
    out[idMap.get(o.id) ?? o.id] = o.kind
  }
  return out
}

/** Byter ett lokalt vägg-id mot serverns, när väggen skapades i samma sparning. */
function withMappedWallId<T extends { wallId?: string }>(
  element: T,
  newWallIds: Map<string, string>,
): T {
  if (!element.wallId) return element
  const mapped = newWallIds.get(element.wallId)
  return mapped ? { ...element, wallId: mapped } : element
}
