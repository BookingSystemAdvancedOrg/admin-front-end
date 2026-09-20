import { apiFetch, ApiError } from '../../shared/api'
import { WORKSPACE, tableSize } from './data'
import type {
  Fixture,
  Floor,
  GroundRect,
  Opening,
  OpeningKind,
  TableElement,
  WallSegment,
} from './data'

/**
 * Klient mot backendens /locations/{id}/layout-elements/*-endpoints.
 *
 * API:t lagrar en PLATT lista av 3D-element (floor/wall/door/window/table)
 * med meter som enhet, medan editorn arbetar i 2D-rutnätsenheter med
 * våningar, markytor och inventarier. Den här filen är översättningen
 * mellan de två modellerna — se `toApiLayout`/`toFloors`.
 *
 * Våningar: en våning är ett `floor`-element (`name`, `level`), och varje
 * vägg/öppning/bord bär `floorId` till sin våning. Vid publicering kräver
 * API:t att alla element hör till en våning i samma utkast. En äldre,
 * platt layout (utan våningar) läses in som en enda våning och migreras
 * automatiskt vid nästa sparning.
 *
 * Vad som INTE går att spara (API:ts datamodell saknar fälten helt, och
 * alla scheman är `additionalProperties: false` så det finns ingen plats
 * att gömma dem i):
 *   - markytor (grounds) och inventarier som kassan (fixtures) — spec:en
 *     säger uttryckligen "`decor` is not supported by the current data model"
 *   - bordens etiketter (T1, T2 …) — återskapas vid inläsning
 *   - skillnaden entré/kökets ingång — båda lagras som `door`
 */

export type ApiElementType = 'floor' | 'wall' | 'door' | 'window' | 'table'

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
  /** Bara våningar: namn och signerad ordning (0 = entréplan). */
  name?: string
  level?: number
  /** Bara icke-våningar: elementId för våningen elementet står på. */
  floorId?: string
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
/** Takhöjd — våningen som volym; editorn har ingen egen siffra för det. */
const FLOOR_HEIGHT_M = 3
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

/**
 * Våningen som volym: hela arbetsytan, centrerad i origo. Editorn har ingen
 * egen geometri för en våning, så måtten är arbetsytans — det som spelar
 * roll för API:t är namnet, nivån och att barnen pekar hit.
 */
function floorToApi(floor: Floor, level: number): LayoutElementCreate {
  return {
    type: 'floor',
    x: 0,
    y: 0,
    z: 0,
    width: toM(WORKSPACE.w),
    height: FLOOR_HEIGHT_M,
    depth: toM(WORKSPACE.h),
    rotationY: 0,
    name: floor.name.trim() || `Våning ${level + 1}`,
    level,
  }
}

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
  // Måtten är satta manuellt (resize-handtagen) — API:t har egna width/
  // depth-fält för dem, så de läses tillbaka i tableFromApi nedan.
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
 * Översätter en vånings innehåll till API-element, nycklade på editorns
 * lokala id så att diffen mot serverns lista kan matcha ihop dem. Element
 * utan giltig geometri (nollängd) utelämnas — API:t kräver dimensioner > 0.
 * Med `floorId` stämplas varje element med sin våning (editorns lokala id;
 * `saveLayout` byter det mot serverns när våningen skapats).
 */
export function toApiElements(
  floor: Floor,
  floorId?: string,
): Map<string, LayoutElementCreate> {
  const out = new Map<string, LayoutElementCreate>()
  const wallById = new Map(floor.walls.map((w) => [w.id, w]))
  const onFloor = (el: LayoutElementCreate): LayoutElementCreate =>
    floorId ? { ...el, floorId } : el

  for (const w of floor.walls) {
    if (w.length > 0) out.set(w.id, onFloor(wallToApi(w)))
  }
  for (const o of floor.openings) {
    const wall = wallById.get(o.wallId)
    if (!wall) continue
    const el = openingToApi(o, wall)
    if (el) out.set(o.id, onFloor(el))
  }
  for (const t of floor.tables) {
    out.set(t.id, onFloor(tableToApi(t)))
  }
  return out
}

/**
 * Hela layouten som API-element: ett `floor` per våning (nivå = ordningen i
 * listan) följt av våningens innehåll med `floorId` satt. Våningens lokala
 * id är nyckeln, så en ny våning och dess barn hänger ihop tills servern
 * gett den ett riktigt elementId.
 */
export function toApiLayout(floors: Floor[]): Map<string, LayoutElementCreate> {
  const out = new Map<string, LayoutElementCreate>()
  floors.forEach((floor, level) => {
    out.set(floor.id, floorToApi(floor, level))
    for (const [id, el] of toApiElements(floor, floor.id)) out.set(id, el)
  })
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
    w: toUnits(el.width),
    h: toUnits(el.depth),
  }
}

/**
 * Bygger en vånings innehåll ur en lista API-element. Våningselement
 * ignoreras (de har ingen 2D-motsvarighet); markytor och inventarier blir
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

/** Editorns id för den enda våningen i en äldre, platt layout. */
export const LEGACY_FLOOR_ID = 'floor-1'

/**
 * Bygger editorns våningar ur serverns lista. Finns `floor`-element blir
 * varje sådant en våning (i nivåordning) och innehållet fördelas via
 * `floorId`; element som saknar våning eller pekar på en okänd hamnar på
 * den första, och rättas vid nästa sparning. Utan våningselement (äldre,
 * platt layout) blir allt en enda våning. Markytor och inventarier hämtas
 * ur det lokalt sparade, per våning.
 */
export function toFloors(
  elements: LayoutElement[],
  extras: LayoutExtras = EMPTY_EXTRAS,
): Floor[] {
  const floorElements = elements
    .filter((e) => e.type === 'floor')
    .sort(
      (a, b) =>
        (a.level ?? 0) - (b.level ?? 0) ||
        a.elementId.localeCompare(b.elementId),
    )

  if (floorElements.length === 0) {
    return [
      {
        id: LEGACY_FLOOR_ID,
        name: 'Våning 1',
        grounds: extras.grounds,
        fixtures: extras.fixtures,
        ...toFloorElements(elements, extras.doorKinds),
      },
    ]
  }

  const known = new Set(floorElements.map((f) => f.elementId))
  return floorElements.map((f, i) => {
    const own = elements.filter(
      (e) =>
        e.type !== 'floor' &&
        (e.floorId === f.elementId ||
          (i === 0 && (!e.floorId || !known.has(e.floorId)))),
    )
    // Första våningen ärver det gamla platta formatets markytor/inventarier
    // så att en migrerad layout inte tappar kassan.
    const local =
      extras.byFloor[f.elementId] ??
      (i === 0
        ? { grounds: extras.grounds, fixtures: extras.fixtures }
        : { grounds: [], fixtures: [] })
    return {
      id: f.elementId,
      name: f.name?.trim() || `Våning ${i + 1}`,
      grounds: local.grounds,
      fixtures: local.fixtures,
      ...toFloorElements(own, extras.doorKinds),
    }
  })
}

/* --- Lokalt sparat (det API:t inte kan lagra) ---------------------------- */

const LOCAL_EXTRAS_KEY = 'admin-layout-extras'

/** Markytor och inventarier — per våning. */
export interface FloorExtras {
  grounds: GroundRect[]
  fixtures: Fixture[]
}

/**
 * Det API:t inte kan lagra — se filhuvudet. Utöver markytor och inventarier
 * ingår `doorKinds`: en karta elementId -> 'entrance' | 'kitchen', eftersom
 * API:t lagrar båda som `door` och annars läser tillbaka varje kök som en
 * entré. `byFloor` nycklas på våningens elementId; `grounds`/`fixtures` på
 * toppnivå är första våningens och finns kvar för äldre sparningar.
 */
export interface LayoutExtras extends FloorExtras {
  doorKinds: Record<string, OpeningKind>
  byFloor: Record<string, FloorExtras>
}

const EMPTY_EXTRAS: LayoutExtras = {
  grounds: [],
  fixtures: [],
  doorKinds: {},
  byFloor: {},
}

function toFloorExtras(value: unknown): FloorExtras {
  const p = (value ?? {}) as Partial<FloorExtras>
  return {
    grounds: Array.isArray(p.grounds) ? p.grounds : [],
    fixtures: Array.isArray(p.fixtures) ? p.fixtures : [],
  }
}

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
    const byFloor: Record<string, FloorExtras> = {}
    if (parsed.byFloor && typeof parsed.byFloor === 'object') {
      for (const [id, value] of Object.entries(parsed.byFloor)) {
        byFloor[id] = toFloorExtras(value)
      }
    }
    return {
      ...toFloorExtras(parsed),
      doorKinds:
        parsed.doorKinds && typeof parsed.doorKinds === 'object'
          ? parsed.doorKinds
          : {},
      byFloor,
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
        byFloor: extras.byFloor,
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

/**
 * Mappar API:ts fel till svenska meddelanden, som usersApi/locationApi.
 * Statuskoden bevaras (felet förblir en ApiError) så att sparningen kan
 * skilja "servern kan inte våningar" (400) från andra fel.
 */
function toFriendlyLayoutError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Ett okänt fel inträffade.')
  }
  console.error(`[Layout] ${err.status}: ${err.message}`)

  switch (err.status) {
    case 400:
      return new ApiError(400, `Layouten avvisades av servern: ${err.message}`)
    case 401:
      return new ApiError(401, 'Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new ApiError(403, 'Du har inte behörighet att ändra layouten.')
    case 404:
      return new ApiError(404, 'Elementet finns inte längre — ladda om sidan.')
    case 409:
      return new ApiError(
        409,
        'Layouten ändrades samtidigt av någon annan. Ladda om och försök igen.',
      )
    case 503:
      return new ApiError(
        503,
        'Layouttjänsten är tillfälligt otillgänglig. Försök igen.',
      )
    default:
      return new ApiError(err.status, err.message || `Serverfel (${err.status}).`)
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

/* --- Publicerade versioner ----------------------------------------------- */

/**
 * En publicerad ögonblicksbild av layouten. Innehållet är oföränderligt:
 * publish kopierar utkastet till en ny numrerad version och rör inga äldre.
 */
export interface PublishedLayoutSnapshot {
  version: number
  label: string
  /** Om versionen är den som gäller. Publish sätter alltid `false` — API:t
   *  har ingen aktiveringsrutt än, så en publicerad version blir aldrig
   *  gällande av sig själv. */
  isCurrent: boolean
  effectiveFrom: string | null
  effectiveTo: string | null
  expiresAt: string | null
  elements: LayoutElement[]
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
}

/** POST .../layout/publish — utan body; API:t numrerar och etiketterar själv. */
export function publishLayout(
  locationId: string,
): Promise<PublishedLayoutSnapshot> {
  return call(() =>
    apiFetch<PublishedLayoutSnapshot>(
      `/locations/${encodeURIComponent(locationId)}/layout/publish`,
      { method: 'POST' },
    ),
  )
}

/**
 * Svaret från en aktivering. Diskrimineras på `status`, eftersom API:t
 * svarar 200 för "gäller nu" och 202 för "schemalagt byte" — och `apiFetch`
 * skiljer inte på statuskoderna.
 */
export type LayoutActivation =
  | { status: 'active'; version: number; effectiveFrom: string }
  | {
      status: 'pending'
      version: number
      currentVersion: number
      cutoverAt: string
    }

/**
 * POST .../layout/versions/{n}/activate — utan body.
 *
 * Aktiveringen är omedelbar bara när platsen saknar gällande version. Finns
 * redan en, schemaläggs bytet till 01:00 UTC fyra veckor fram och svaret blir
 * `pending`. Att upprepa samma begäran är ofarligt, men att begära en ANNAN
 * version medan ett byte väntar ger 409.
 */
export async function activateLayoutVersion(
  locationId: string,
  version: number,
): Promise<LayoutActivation> {
  try {
    return await apiFetch<LayoutActivation>(
      `/locations/${encodeURIComponent(locationId)}/layout/versions/${version}/activate`,
      { method: 'POST' },
    )
  } catch (err) {
    // 409 betyder här något annat än i resten av layout-API:t: ett byte till
    // en annan version är redan inbokat. Den generiska "ändrades samtidigt"
    // hade pekat användaren helt fel.
    if (err instanceof ApiError && err.status === 409) {
      throw new Error(
        'Ett versionsbyte är redan inbokat. Vänta tills det genomförts, ' +
          'eller aktivera om den version som redan väntar.',
      )
    }
    throw toFriendlyLayoutError(err)
  }
}

/** GET .../layout/versions — nyast först enligt kontraktet. */
export function listLayoutVersions(
  locationId: string,
): Promise<PublishedLayoutSnapshot[]> {
  return call(async () => {
    const res = await apiFetch<{ items?: PublishedLayoutSnapshot[] }>(
      `/locations/${encodeURIComponent(locationId)}/layout/versions`,
    )
    return res.items ?? []
  })
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
  'name',
  'level',
  'floorId',
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
  /** Serverns lista efter sparandet — används för att läsa in layouten igen. */
  elements: LayoutElement[]
  /**
   * Lokalt id -> serverns elementId för allt som just skapades. Behövs för
   * att kunna föra över lokalt lagrade egenskaper (t.ex. om en dörr är
   * entré eller kök, eller vilken våning kassan står på) till det id
   * servern nu använder.
   */
  idMap: Map<string, string>
  /**
   * Sant när servern avvisade våningselement och layouten i stället
   * sparades platt (bara första våningen, utan `floorId`) — som förr.
   */
  flat: boolean
}

/** Servern avvisade ett `floor`-element — den saknar våningsstöd. */
class FloorsUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FloorsUnsupportedError'
  }
}

/**
 * Sparar hela layouten med våningar. Skulle servern avvisa `floor`-typen
 * (äldre backend) görs om sparningen i det gamla platta läget, så att
 * åtminstone första våningen alltid går att spara.
 */
export async function saveLayout(
  locationId: string,
  floors: Floor[],
): Promise<LayoutSaveResult> {
  try {
    return await saveElements(locationId, toApiLayout(floors), false)
  } catch (err) {
    if (!(err instanceof FloorsUnsupportedError)) throw err
    console.warn(`[Layout] Servern saknar våningsstöd — sparar platt: ${err.message}`)
    return saveElements(locationId, toApiElements(floors[0]), true)
  }
}

/**
 * Hämtar serverns nuvarande lista, räknar ut skillnaden mot `desired` och
 * kör de anrop som behövs.
 *
 * Skapandet sker i beroendeordning: våningar först, sedan väggar, sedan
 * resten. En ny dörr/fönster bär väggens LOKALA id i `wallId`, och allt
 * nytt bär våningens lokala id i `floorId` — de måste bytas mot serverns id
 * innan elementet skapas, annars pekar det ut i tomma intet. Samma
 * ommappning gäller uppdateringar (en gammal vägg som nu får en våning).
 */
async function saveElements(
  locationId: string,
  desired: Map<string, LayoutElementCreate>,
  flat: boolean,
): Promise<LayoutSaveResult> {
  const stored = await listLayoutElements(locationId)
  const diff = diffLayout(desired, stored)

  for (const elementId of diff.deleted) {
    await deleteLayoutElement(locationId, elementId)
  }

  // Lokalt id -> serverns elementId för allt som just skapats.
  const idMap = new Map<string, string>()
  const ofType = (match: (t: ApiElementType) => boolean) =>
    diff.created.filter(([, el]) => match(el.type))

  for (const [localId, element] of ofType((t) => t === 'floor')) {
    try {
      const saved = await createLayoutElement(locationId, element)
      idMap.set(localId, saved.elementId)
    } catch (err) {
      // Bara ett valideringsfel på själva våningen betyder "kan inte
      // våningar"; allt annat (behörighet, nätverk) ska upp till användaren.
      if (err instanceof ApiError && err.status === 400) {
        throw new FloorsUnsupportedError(err.message)
      }
      throw err
    }
  }
  for (const [localId, element] of ofType((t) => t === 'wall')) {
    const saved = await createLayoutElement(
      locationId,
      withMappedRefs(element, idMap),
    )
    idMap.set(localId, saved.elementId)
  }
  for (const [localId, element] of ofType((t) => t !== 'floor' && t !== 'wall')) {
    const saved = await createLayoutElement(
      locationId,
      withMappedRefs(element, idMap),
    )
    idMap.set(localId, saved.elementId)
  }
  for (const [elementId, updates] of diff.updated) {
    await updateLayoutElement(
      locationId,
      elementId,
      withMappedRefs(updates, idMap),
    )
  }

  return {
    created: diff.created.length,
    updated: diff.updated.length,
    deleted: diff.deleted.length,
    elements: await listLayoutElements(locationId),
    idMap,
    flat,
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

/**
 * Byter lokala vägg- och våningsreferenser mot serverns id, när väggen
 * eller våningen skapades i samma sparning.
 */
function withMappedRefs<T extends { wallId?: string; floorId?: string }>(
  element: T,
  newIds: Map<string, string>,
): T {
  let out = element
  const wallId = element.wallId && newIds.get(element.wallId)
  if (wallId) out = { ...out, wallId }
  const floorId = element.floorId && newIds.get(element.floorId)
  if (floorId) out = { ...out, floorId }
  return out
}
