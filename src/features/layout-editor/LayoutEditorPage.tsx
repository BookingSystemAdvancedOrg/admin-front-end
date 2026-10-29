import { errorText } from '../../shared/errors'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { getStoredLocationId, useLocationId } from '../../shared/location'
import { LayoutVersionsModal } from './LayoutVersionsModal'
import {
  GRID,
  MIN_TABLE_SIZE,
  OPENING_LABEL,
  SEAT_D,
  SEAT_W,
  WORKSPACE,
  ZONES,
  defaultTableSize,
  emptyFloor,
  seatPositions,
  tableSize,
} from './data'
import type {
  Fixture,
  Floor,
  GroundRect,
  Opening,
  OpeningKind,
  TableElement,
  TableShape,
  WallSegment,
} from './data'
import {
  activateLayoutVersion,
  listLayoutElements,
  listLayoutVersions,
  publishLayout,
  saveLayout,
  toFloors,
} from './layoutApi'
import {
  actionForKey,
  isTypingTarget,
  keyForTool,
  nextTableNumber,
  nudgeDelta,
  panForZoom,
  pasteClip,
  record,
  redo,
  snapToGuides,
  startHistory,
  tableRow,
  turnTable,
  undo,
  wallTowards,
  formatMetres,
  formatSize,
  moveClipsTo,
} from './editorTools'
import type { Clip, EditorAction, Guide, History, ShortcutTool } from './editorTools'
import './layout-editor.css'
import { Icon, type IconName } from '../../shared/Icon'

const TILT_DEG = 55
const PERSPECTIVE = 1600
const TABLE_HEIGHT = 22
const WALL_HEIGHT = 90
/** Sockelhöjd för väggar som vetter mot kameran - borden ska alltid synas. */
const WALL_LOW = 16
const WALL_THICKNESS = 10
const OPENING_THICKNESS = 14
const COUNTER_HEIGHT = 34
/**
 * Hur långt från en vägg man får klicka och ändå träffa den. Måttet gäller
 * i golvplanet, och i 3D-vyn blir den zonen visuellt smal - därför generöst
 * tilltaget, annars är fönster och dörrar svåra att sätta dit.
 */
const WALL_SNAP_DIST = 60

/** Standardbredd på en öppning som placeras med ett enkelt klick. */
const OPENING_DEFAULT_LENGTH: Record<OpeningKind, number> = {
  window: 140,
  entrance: 120,
  kitchen: 80,
}
const HALF_W = WORKSPACE.w / 2
const HALF_H = WORKSPACE.h / 2

type Tool =
  | 'select'
  | 'ground'
  | 'wall'
  | 'window'
  | 'entrance'
  | 'kitchen'
  | 'counter'
  | 'add-square'
  | 'add-round'
  | 'erase'

type SelItem =
  | { kind: 'table'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'fixture'; id: string }
  | { kind: 'ground'; id: string }

type Selection = SelItem | null

/** Det som går att flytta, kopiera och markera med ruta tillsammans. */
const GROUPABLE: SelItem['kind'][] = ['table', 'fixture', 'wall']

type DragState =
  | {
      kind: 'table' | 'fixture'
      id: string
      startX: number
      startY: number
      origX: number
      origY: number
    }
  | { kind: 'wall-move'; id: string; offX: number; offY: number }
  | { kind: 'wall-end'; id: string; end: 'a' | 'b' }
  | { kind: 'op-move'; id: string; grab: number }
  | { kind: 'op-end'; id: string; end: 'a' | 'b' }
  | { kind: 'rotate'; startX: number; startSpin: number }
  | { kind: 'pan'; startX: number; startY: number; origX: number; origY: number }
  | {
      kind: 'group'
      startX: number
      startY: number
      tables: Map<string, { x: number; y: number }>
      fixtures: Map<string, { x: number; y: number }>
      walls: Map<string, { x: number; y: number }>
    }
  | { kind: 'marquee'; x0: number; y0: number; additive: boolean }
  | { kind: 'table-resize'; id: string; edge: 'n' | 's' | 'e' | 'w' }

interface WallDraft {
  x0: number
  y0: number
  dir: 'h' | 'v'
  x: number
  y: number
  length: number
}

interface OpeningDraft {
  kind: OpeningKind
  wallId: string
  offset0: number
  offset: number
  length: number
}

interface GroundDraft {
  x0: number
  y0: number
  x: number
  y: number
  w: number
  h: number
}

const OPENING_TOOLS: { tool: Tool; kind: OpeningKind; warn: string }[] = [
  { tool: 'window', kind: 'window', warn: 'Fönster kan bara placeras på en vägg - rita väggen först.' },
  { tool: 'entrance', kind: 'entrance', warn: 'Entrén kan bara placeras på en vägg - rita väggen först.' },
  { tool: 'kitchen', kind: 'kitchen', warn: 'Kökets ingång kan bara placeras på en vägg - rita väggen först.' },
]

/**
 * Figma: admin-live-layout-editor-page (26:2), byggd som riktig 3D-scen i
 * CSS. Origo ligger i canvasens mitt. Marken ritas fritt och får
 * automatiskt väggar runt om. Väggar som vetter mot kameran sänks till en
 * låg sockel så att borden alltid syns (och reser sig igen när vyn
 * roteras). Öppningar - fönster, entré, kökets ingång - sitter PÅ
 * väggarna: väggen förblir hel, öppningen glider längs den när den
 * flyttas eller förlängs, och följer med om väggen flyttas.
 *
 * Våningar, väggar, öppningar och bord synkas mot det riktiga layout-API:t
 * (layoutApi.ts): de läses in vid sidladdning och skrivs vid "Spara
 * utkast"/"Publicera layout". Markytor och kassan finns inte i API:ts
 * datamodell och lever bara lokalt - se kommentaren i layoutApi.ts.
 */
export default function LayoutEditorPage() {
  // Den faktiskt inloggade användaren - statusraden visade tidigare ett
  // påhittat namn ("Anna") oavsett vem som satt vid tangentbordet.
  const { email: editorEmail, sub: editorSub, groups } = useAuth()
  const canActivate =
    groups.includes('owner_user') || groups.includes('super_user')
  const editorName = editorEmail ? editorEmail.split('@')[0] : ''
  // Editorn startar tom och fylls av serverns layout. Ingen mockdata visas
  // först - den hann annars blinka förbi innan inläsningen var klar.
  const [floors, setFloors] = useState<Floor[]>(() => [emptyFloor(1)])
  const [currentFloorId, setCurrentFloorId] = useState(() => floors[0].id)
  // Allt som är markerat (Shift-klick och ruta väljer flera). `selection`
  // nedan är det ENDA valda elementet när bara ett är valt - egenskapspanelen,
  // handtagen och resten av den äldre koden bygger på den.
  const [selected, setSelected] = useState<SelItem[]>([])
  const selection: Selection = selected.length === 1 ? selected[0] : null
  function setSelection(next: Selection | ((cur: Selection) => Selection)) {
    setSelected((cur) => {
      const single = cur.length === 1 ? cur[0] : null
      const value = typeof next === 'function' ? next(single) : next
      return value ? [value] : []
    })
  }
  function isSel(kind: SelItem['kind'], id: string): boolean {
    return selected.some((s) => s.kind === kind && s.id === id)
  }
  // Ruta för att markera flera (skärmkoordinater relativt scenen).
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x: number; y: number; additive: boolean } | null>(null)
  // Hjälplinjer som visas medan ett bord eller kassan dras.
  const [guides, setGuides] = useState<Guide[]>([])
  // Ett bord som dras från verktygsfältet ut på planen.
  const [placing, setPlacing] = useState<{ shape: TableShape; x: number; y: number; over: boolean } | null>(null)
  const [rowCount, setRowCount] = useState(4)
  // Väggar som en sammanhängande linje (som i draw.io): klick sätter hörn,
  // dubbelklick/Enter/Esc avslutar. `start` är linjens första punkt - klickar
  // man där igen sluts rummet.
  const [wallChain, setWallChain] = useState<{ startX: number; startY: number } | null>(null)
  // Pekarens läge i scenen, för måttlappen som visas medan man ritar.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  // Högerklicksmenyn: var den öppnades (fönsterkoordinater), vad som
  // klickades och motsvarande punkt på golvet.
  const [menu, setMenu] = useState<{ x: number; y: number; target: SelItem | null; at: { x: number; y: number } } | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [is3d, setIs3d] = useState(true)
  // Visar våningen under som en genomskinlig skugga - så att man alltid ser
  // att man befinner sig på en annan våning, och kan rikta in t.ex. en
  // trappa mot samma plats som på våningen under.
  const [showFloorBelow, setShowFloorBelow] = useState(true)
  // Handverktyget (H, eller håll inne mellanslag - som i Figma): klick+drag
  // panorerar vyn i stället för att rita/välja. Vyn roteras med Alt+drag
  // eller ⟲ ⟳. isRotating stänger av vyns 320ms-övergång under själva
  // draget (rotation eller panorering), så vyn följer musen direkt.
  const [handMode, setHandMode] = useState(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const [isRotating, setIsRotating] = useState(false)
  const [spin, setSpin] = useState(45)
  const [manualZoom, setManualZoom] = useState(1)
  // Panorering i skärmpixlar från scenens mitt. Vyn följer inte längre
  // innehållet automatiskt (då hoppade den medan man ritade) - den passas
  // in vid inläsning, våningsbyte och "Zooma till allt" (Shift+1).
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fitBounds, setFitBounds] = useState(() => contentBounds(emptyFloor(1)))
  const [showHelp, setShowHelp] = useState(false)
  const [sceneSize, setSceneSize] = useState({ w: 1000, h: 600 })
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null)
  const [openingDraft, setOpeningDraft] = useState<OpeningDraft | null>(null)
  const [groundDraft, setGroundDraft] = useState<GroundDraft | null>(null)
  const [drawWarning, setDrawWarning] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Hämtar layout…')
  const [versionLabel, setVersionLabel] = useState('')
  // Utan en sparad plats finns inget layout-API att prata med - då kör
  // editorn vidare på mockdatan som förut.
  // Samma återhämtning som i Inställningar: en ny webbläsare känner inte
  // till plats-ID:t även om layouten finns sparad i databasen.
  const { locationId, resolving: resolvingLocation } = useLocationId(editorSub)
  const [publishing, setPublishing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  // "Se live": byter tillfälligt ut `floors`/`currentFloorId` mot den
  // aktiva publicerade versionens innehåll, skrivskyddat. `draftBackup`
  // minns utkastet så det går att växla tillbaka utan att förlora något.
  const [viewMode, setViewMode] = useState<'draft' | 'live'>('draft')
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [liveVersionLabel, setLiveVersionLabel] = useState('')
  const draftBackup = useRef<{ floors: Floor[]; currentFloorId: string } | null>(
    null,
  )
  const readOnly = viewMode === 'live'
  const sceneRef = useRef<HTMLDivElement>(null)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextId = useRef(1)
  const drag = useRef<DragState | null>(null)
  // Ångra/gör om. `present` i historiken är det senast incheckade läget;
  // markDirty() begär en incheckning som görs när React har lagt in
  // ändringen (effekten nedan), så ett helt drag blir ETT steg.
  const history = useRef<History>(startHistory(floors))
  const commitRequested = useRef(false)
  const [commitTick, setCommitTick] = useState(0)
  const [, setHistoryTick] = useState(0)
  const clipboard = useRef<Clip[] | null>(null)
  const pasteCount = useRef(0)

  const floor = floors.find((f) => f.id === currentFloorId) ?? floors[0]
  const floorIndex = floors.findIndex((f) => f.id === floor.id)
  const belowFloor =
    showFloorBelow && floorIndex > 0 ? floors[floorIndex - 1] : null

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const ro = new ResizeObserver(() => {
      setSceneSize({ w: scene.clientWidth, h: scene.clientHeight })
    })
    ro.observe(scene)
    // Som i Figma: scroll (eller två fingrar på styrplattan) panorerar,
    // Cmd/Ctrl+scroll och nyp zoomar mot muspekaren. Nyp på en Mac kommer
    // som wheel med ctrlKey.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = scene.getBoundingClientRect()
        zoomBy(Math.pow(1.0015, -e.deltaY), {
          x: e.clientX - rect.left - rect.width / 2,
          y: e.clientY - rect.top - rect.height / 2,
        })
        return
      }
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
    scene.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      scene.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Läs in den sparade layouten: våningar med sitt innehåll.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listLayoutElements(locationId)
      .then((elements) => {
        if (cancelled) return
        const loaded = toFloors(elements)
        setFloors(loaded)
        setCurrentFloorId(loaded[0].id)
        setSelection(null)
        resetHistory(loaded)
        fitTo(loaded[0])
        const drawn = elements.filter((e) => e.type !== 'floor').length
        setStatusText(
          drawn === 0
            ? 'Tom layout - rita och spara för att komma igång.'
            : `Utkast inläst från servern - ${drawn} element på ${loaded.length} ` +
                (loaded.length === 1 ? 'våning.' : 'våningar.'),
        )
        void versionLabelFor(locationId).then((label) => {
          if (!cancelled) setVersionLabel(label)
        })
      })
      .catch((err) => {
        if (!cancelled) {
          setLayoutError(
            errorText(err, 'Kunde inte hämta layouten.'),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  function patchFloor(patch: (f: Floor) => Partial<Floor>) {
    // Nästan all redigering går via den här funktionen - en enda spärr här
    // stoppar ritning, flytt, storleksändring och radering i skrivskyddat
    // "Se live"-läge, utan att varje enskild åtgärd behöver kolla själv.
    if (readOnly) return
    setFloors((prev) =>
      prev.map((f) => (f.id === floor.id ? { ...f, ...patch(f) } : f)),
    )
  }

  const selectedTable =
    selection?.kind === 'table'
      ? floor.tables.find((t) => t.id === selection.id) ?? null
      : null
  const selectedWall =
    selection?.kind === 'wall'
      ? floor.walls.find((w) => w.id === selection.id) ?? null
      : null
  const selectedOpening =
    selection?.kind === 'opening'
      ? floor.openings.find((o) => o.id === selection.id) ?? null
      : null
  const selectedFixture =
    selection?.kind === 'fixture'
      ? floor.fixtures.find((f) => f.id === selection.id) ?? null
      : null
  const selectedGround =
    selection?.kind === 'ground'
      ? floor.grounds.find((g) => g.id === selection.id) ?? null
      : null

  function markDirty() {
    setStatusText('Osparade ändringar (utkast, ej publicerat)')
    commitRequested.current = true
    setCommitTick((t) => t + 1)
  }

  // Incheckningen: körs efter att ändringen som markDirty() gällde har
  // hamnat i `floors`. Mellanlägen under ett drag begär ingen incheckning.
  useEffect(() => {
    if (!commitRequested.current) return
    commitRequested.current = false
    if (readOnly) return
    const next = record(history.current, floors)
    if (next !== history.current) {
      history.current = next
      setHistoryTick((t) => t + 1)
    }
  }, [floors, commitTick, readOnly])

  /** Ny historik, t.ex. när utkastet lästs in eller sparats. */
  function resetHistory(present: Floor[]) {
    history.current = startHistory(present)
    commitRequested.current = false
    setHistoryTick((t) => t + 1)
  }

  function applyHistory(h: History | null) {
    if (!h || readOnly || drag.current) return
    history.current = h
    setFloors(h.present)
    if (!h.present.some((f) => f.id === currentFloorId)) {
      setCurrentFloorId(h.present[0].id)
    }
    setSelection(null)
    setWallDraft(null)
    setOpeningDraft(null)
    setGroundDraft(null)
    setStatusText('Osparade ändringar (utkast, ej publicerat)')
    setHistoryTick((t) => t + 1)
  }

  const canUndo = !readOnly && history.current.past.length > 0
  const canRedo = !readOnly && history.current.future.length > 0

  function warn(message: string) {
    setDrawWarning(message)
    if (warnTimer.current) clearTimeout(warnTimer.current)
    warnTimer.current = setTimeout(() => setDrawWarning(null), 3000)
  }

  /* --- Auto-zoom -------------------------------------------------------- */

  const bounds = fitBounds
  const pad = 90
  const bw = bounds.w + pad * 2
  const bh = bounds.h + pad * 2
  let fit: number
  if (is3d) {
    const T = (TILT_DEG * Math.PI) / 180
    const diag = (bw + bh) * 0.707
    fit = Math.min(sceneSize.w / diag, sceneSize.h / (diag * Math.cos(T) + 150))
  } else {
    const straight = spin % 180 === 0
    const quarter = spin % 90 === 0 && !straight
    const pw = straight ? bw : quarter ? bh : Math.hypot(bw, bh)
    const ph = straight ? bh : quarter ? bw : Math.hypot(bw, bh)
    fit = Math.min(sceneSize.w / pw, sceneSize.h / ph)
  }
  const zoom = clamp(fit, 0.2, 1.15) * manualZoom
  const tx = -(bounds.x + bounds.w / 2)
  const ty = -(bounds.y + bounds.h / 2)

  // Senaste vy-värdena för händelselyssnare som registreras en gång (hjulet).
  const view = useRef({ manualZoom, pan })
  view.current = { manualZoom, pan }

  /** Zoomar med `factor`, med punkten `cursor` (px från scenens mitt) stilla. */
  function zoomBy(factor: number, cursor = { x: 0, y: 0 }) {
    const from = view.current.manualZoom
    const to = clamp(from * factor, 0.2, 4)
    if (to === from) return
    setManualZoom(to)
    setPan(panForZoom(view.current.pan, cursor, from, to))
  }

  /** "Zooma till allt": passar in hela våningen och nollställer panorering. */
  function fitTo(target: Floor) {
    setFitBounds(contentBounds(target))
    setManualZoom(1)
    setPan({ x: 0, y: 0 })
  }

  /* --- Smart väggsänkning (dockskåpsvy) --------------------------------- */

  const spinRad = (spin * Math.PI) / 180
  // Riktning i golvkoordinater som pekar mot kameran (skärmens nederkant).
  const viewDir = { x: Math.sin(spinRad), y: Math.cos(spinRad) }

  function groundContains(x: number, y: number): boolean {
    return floor.grounds.some(
      (g) => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h,
    )
  }

  /**
   * Lokalens mittpunkt utifrån väggarnas utsträckning. Behövs för att veta
   * vilket håll som är "inomhus" när det inte finns någon ritad markyta -
   * vilket alltid är fallet för en layout som lästs in från API:t, eftersom
   * markytor bara sparas lokalt.
   */
  function wallsCentre(): { x: number; y: number } | null {
    if (floor.walls.length === 0) return null
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const w of floor.walls) {
      const x2 = w.dir === 'h' ? w.x + w.length : w.x
      const y2 = w.dir === 'v' ? w.y + w.length : w.y
      minX = Math.min(minX, w.x, x2)
      maxX = Math.max(maxX, w.x, x2)
      minY = Math.min(minY, w.y, y2)
      maxY = Math.max(maxY, w.y, y2)
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  }

  /**
   * En vägg sänks till sockel när den står mellan kameran och rummet -
   * så att borden alltid syns. Vald vägg (eller vägg med vald öppning)
   * hålls alltid uppe så att den går att redigera.
   */
  function isLowered(w: WallSegment): boolean {
    if (!is3d) return false
    if (isSel('wall', w.id)) return false
    if (selection?.kind === 'opening') {
      const o = floor.openings.find((op) => op.id === selection.id)
      if (o?.wallId === w.id) return false
    }
    const midX = w.dir === 'h' ? w.x + w.length / 2 : w.x
    const midY = w.dir === 'h' ? w.y : w.y + w.length / 2
    const n = w.dir === 'h' ? { x: 0, y: 1 } : { x: 1, y: 0 }
    const off = 14
    const aIn = groundContains(midX + n.x * off, midY + n.y * off)
    const bIn = groundContains(midX - n.x * off, midY - n.y * off)

    let nInt: { x: number; y: number }
    if (aIn !== bIn) {
      nInt = aIn ? n : { x: -n.x, y: -n.y }
    } else {
      // Ingen markyta att gå på (t.ex. en layout inläst från API:t, där
      // markytor inte lagras). Använd lokalens mitt som "inomhus" istället,
      // annars skulle ingen vägg någonsin sänkas och de närmaste väggarna
      // skymma hela rummet.
      const centre = wallsCentre()
      if (!centre) return false
      const toCentre = { x: centre.x - midX, y: centre.y - midY }
      const dot = n.x * toCentre.x + n.y * toCentre.y
      // Väggen går genom mitten - den skymmer inget, låt den stå.
      if (Math.abs(dot) < 1) return false
      nInt = dot > 0 ? n : { x: -n.x, y: -n.y }
    }
    return nInt.x * viewDir.x + nInt.y * viewDir.y < 0
  }

  /* --- Koordinater ------------------------------------------------------ */

  function unproject(clientX: number, clientY: number): { x: number; y: number } {
    const scene = sceneRef.current
    if (!scene) return { x: 0, y: 0 }
    const rect = scene.getBoundingClientRect()
    const mx = clientX - (rect.left + rect.width / 2 + pan.x)
    const my = clientY - (rect.top + rect.height / 2 + pan.y)
    const T = is3d ? (TILT_DEG * Math.PI) / 180 : 0
    const d = PERSPECTIVE
    const k = zoom
    const yr = (my * d) / (k * (d * Math.cos(T) + my * Math.sin(T)))
    const f = d / (d - k * yr * Math.sin(T))
    const xr = mx / (k * f)
    const x = xr * Math.cos(spinRad) + yr * Math.sin(spinRad)
    const y = -xr * Math.sin(spinRad) + yr * Math.cos(spinRad)
    return { x: x - tx, y: y - ty }
  }

  function snap(v: number): number {
    return Math.round(v / GRID) * GRID
  }

  function nearestWall(p: { x: number; y: number }): WallSegment | null {
    let best: WallSegment | null = null
    let bestDist = WALL_SNAP_DIST
    for (const w of floor.walls) {
      // Vinkelrätt avstånd får vara generöst, men längs väggen räcker en
      // rutnätsruta utanför ändarna - annars fångas grannväggen i hörnen.
      const withinExtent =
        w.dir === 'h'
          ? p.x >= w.x - GRID && p.x <= w.x + w.length + GRID
          : p.y >= w.y - GRID && p.y <= w.y + w.length + GRID
      if (!withinExtent) continue
      const dist = w.dir === 'h' ? Math.abs(p.y - w.y) : Math.abs(p.x - w.x)
      if (dist <= bestDist) {
        bestDist = dist
        best = w
      }
    }
    return best
  }

  /** Koordinat längs väggens riktning. */
  function along(w: WallSegment, p: { x: number; y: number }): number {
    return w.dir === 'h' ? p.x : p.y
  }

  function wallStart(w: WallSegment): number {
    return w.dir === 'h' ? w.x : w.y
  }

  /** Håller en öppning inom sin vägg (efter att väggen ändrats). */
  function clampOpening(o: Opening, wall: WallSegment): Opening {
    const length = clamp(o.length, Math.min(GRID, wall.length), wall.length)
    const offset = clamp(o.offset, 0, wall.length - length)
    return { ...o, offset, length }
  }

  const openingTool = OPENING_TOOLS.find((o) => o.tool === tool) ?? null
  const isDrawTool =
    tool === 'wall' || tool === 'ground' || tool === 'counter' || Boolean(openingTool)

  /* --- Rita ------------------------------------------------------------- */

  /** Panorera: handverktyget, mellanslag hållet, eller mittenknappen. */
  function isPanGesture(e: ReactPointerEvent): boolean {
    return handMode || spaceDown || e.button === 1
  }

  function onScenePointerDown(e: ReactPointerEvent) {
    if (isPanGesture(e)) {
      e.preventDefault() // mittenknappen startar annars webbläsarens autoscroll
      setIsRotating(true)
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, origX: pan.x, origY: pan.y }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (e.altKey) {
      // Alt+drag roterar vyn - var som helst, även ovanpå ett element.
      setIsRotating(true)
      drag.current = { kind: 'rotate', startX: e.clientX, startSpin: spin }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const p = unproject(e.clientX, e.clientY)
    const px = clamp(snap(p.x), -HALF_W, HALF_W)
    const py = clamp(snap(p.y), -HALF_H, HALF_H)
    if (tool === 'ground') {
      setGroundDraft({ x0: px, y0: py, x: px, y: py, w: 0, h: 0 })
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (tool === 'wall') {
      if (wallChain && wallDraft) {
        // Nästa hörn i linjen: väggen fram till hit läggs in och nästa
        // börjar där den slutade. Ett klick på samma punkt (dubbelklick)
        // avslutar, liksom ett klick på linjens första punkt (slutet rum).
        const seg = wallTowards(wallDraft.x0, wallDraft.y0, px, py)
        if (seg.length < GRID) {
          finishWallChain()
          return
        }
        addWall(seg)
        if (seg.end.x === wallChain.startX && seg.end.y === wallChain.startY) {
          finishWallChain()
          return
        }
        setWallDraft({ x0: seg.end.x, y0: seg.end.y, dir: seg.dir, x: seg.end.x, y: seg.end.y, length: 0 })
        return
      }
      setWallDraft({ x0: px, y0: py, dir: 'h', x: px, y: py, length: 0 })
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (openingTool) {
      const host = nearestWall(p)
      if (!host) {
        warn(openingTool.warn)
        return
      }
      const o0 = clamp(snap(along(host, p)) - wallStart(host), 0, host.length)
      setOpeningDraft({
        kind: openingTool.kind,
        wallId: host.id,
        offset0: o0,
        offset: o0,
        length: 0,
      })
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (tool === 'counter') {
      addCounter(p)
      return
    }
    if (tool === 'select') {
      // Dra på tom yta = markera med en ruta (Shift lägger till). Ett klick
      // utan drag avmarkerar, som förut.
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      const x0 = e.clientX - rect.left
      const y0 = e.clientY - rect.top
      drag.current = { kind: 'marquee', x0, y0, additive: e.shiftKey }
      setMarquee({ x0, y0, x: x0, y: y0, additive: e.shiftKey })
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    }
  }

  /** Allt som ligger inom rutan (mittpunkten på skärmen, så det funkar i 3D). */
  function hitsInMarquee(box: { x0: number; y0: number; x: number; y: number }): SelItem[] {
    const scene = sceneRef.current
    if (!scene) return []
    const rect = scene.getBoundingClientRect()
    const left = rect.left + Math.min(box.x0, box.x)
    const right = rect.left + Math.max(box.x0, box.x)
    const top = rect.top + Math.min(box.y0, box.y)
    const bottom = rect.top + Math.max(box.y0, box.y)
    const out: SelItem[] = []
    scene.querySelectorAll<HTMLElement>('[data-sel-kind]').forEach((el) => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (!GROUPABLE.includes(el.dataset.selKind as SelItem['kind'])) return
      if (cx >= left && cx <= right && cy >= top && cy <= bottom) {
        out.push({ kind: el.dataset.selKind as SelItem['kind'], id: el.dataset.selId! } as SelItem)
      }
    })
    return out
  }

  function onScenePointerMove(e: ReactPointerEvent) {
    // Måttlappen följer pekaren medan något ritas eller ändrar storlek.
    const dk = drag.current?.kind
    if (wallDraft || groundDraft || openingDraft || dk === 'table-resize' || dk === 'wall-end' || dk === 'op-end') {
      const r = (e.currentTarget as Element).getBoundingClientRect()
      setPointer({ x: e.clientX - r.left, y: e.clientY - r.top })
    }
    if (groundDraft) {
      const p = unproject(e.clientX, e.clientY)
      const px = clamp(snap(p.x), -HALF_W, HALF_W)
      const py = clamp(snap(p.y), -HALF_H, HALF_H)
      setGroundDraft({
        ...groundDraft,
        x: Math.min(groundDraft.x0, px),
        y: Math.min(groundDraft.y0, py),
        w: Math.abs(px - groundDraft.x0),
        h: Math.abs(py - groundDraft.y0),
      })
      return
    }
    if (openingDraft) {
      const host = floor.walls.find((w) => w.id === openingDraft.wallId)
      if (!host) return
      const p = unproject(e.clientX, e.clientY)
      const cur = clamp(snap(along(host, p)) - wallStart(host), 0, host.length)
      setOpeningDraft({
        ...openingDraft,
        offset: Math.min(openingDraft.offset0, cur),
        length: Math.abs(cur - openingDraft.offset0),
      })
      return
    }
    if (wallDraft) {
      const p = unproject(e.clientX, e.clientY)
      const seg = wallTowards(
        wallDraft.x0,
        wallDraft.y0,
        clamp(snap(p.x), -HALF_W, HALF_W),
        clamp(snap(p.y), -HALF_H, HALF_H),
      )
      setWallDraft({ ...wallDraft, dir: seg.dir, x: seg.x, y: seg.y, length: seg.length })
      return
    }
    const d = drag.current
    if (!d) return

    if (d.kind === 'pan') {
      setPan({ x: d.origX + e.clientX - d.startX, y: d.origY + e.clientY - d.startY })
      return
    }

    if (d.kind === 'rotate') {
      // Minus: rotateZ(+) vrider medurs, så golvets närmaste kant flyttade
      // sig mot dragningen. Nu följer den musen - samma som kundsajten.
      setSpin(d.startSpin - (e.clientX - d.startX) * 0.4)
      return
    }

    if (d.kind === 'table-resize') {
      const p = unproject(e.clientX, e.clientY)
      patchFloor((fl) => ({
        tables: fl.tables.map((t) => {
          if (t.id !== d.id) return t

          // Runda bord förblir runda - vilket handtag som helst ändrar bara
          // diametern, symmetriskt kring bordets mitt (som förblir stilla).
          // Fyrkantiga/rektangulära bord ändras bara på den sida man drar i;
          // motstående kant hålls fast.
          if (t.shape === 'round') {
            const minR = MIN_TABLE_SIZE / 2
            let r = t.w / 2
            if (d.edge === 'e') r = clamp(p.x - t.x, minR, HALF_W)
            else if (d.edge === 'w') r = clamp(t.x - p.x, minR, HALF_W)
            else if (d.edge === 's') r = clamp(p.y - t.y, minR, HALF_H)
            else r = clamp(t.y - p.y, minR, HALF_H)
            return { ...t, w: r * 2, h: r * 2 }
          }

          const left = t.x - t.w / 2
          const right = t.x + t.w / 2
          const top = t.y - t.h / 2
          const bottom = t.y + t.h / 2
          // Motstående kant hålls fast - bordet växer/krymper bara från den
          // sida eller ände man drar i.
          if (d.edge === 'e') {
            const nx = clamp(p.x, left + MIN_TABLE_SIZE, HALF_W)
            return { ...t, w: nx - left, x: (left + nx) / 2 }
          }
          if (d.edge === 'w') {
            const nx = clamp(p.x, -HALF_W, right - MIN_TABLE_SIZE)
            return { ...t, w: right - nx, x: (right + nx) / 2 }
          }
          if (d.edge === 's') {
            const ny = clamp(p.y, top + MIN_TABLE_SIZE, HALF_H)
            return { ...t, h: ny - top, y: (top + ny) / 2 }
          }
          const ny = clamp(p.y, -HALF_H, bottom - MIN_TABLE_SIZE)
          return { ...t, h: bottom - ny, y: (bottom + ny) / 2 }
        }),
      }))
      return
    }

    if (d.kind === 'wall-move' || d.kind === 'wall-end') {
      const p = unproject(e.clientX, e.clientY)
      patchFloor((fl) => {
        const walls = fl.walls.map((w) => {
          if (w.id !== d.id) return w
          if (d.kind === 'wall-move') {
            const nx = clamp(snap(p.x - d.offX), -HALF_W, HALF_W - (w.dir === 'h' ? w.length : 0))
            const ny = clamp(snap(p.y - d.offY), -HALF_H, HALF_H - (w.dir === 'v' ? w.length : 0))
            return { ...w, x: nx, y: ny }
          }
          if (w.dir === 'h') {
            const pos = clamp(snap(p.x), -HALF_W, HALF_W)
            if (d.end === 'a') {
              const nx = Math.min(pos, w.x + w.length - GRID)
              return { ...w, x: nx, length: w.x + w.length - nx }
            }
            return { ...w, length: Math.max(GRID, pos - w.x) }
          }
          const pos = clamp(snap(p.y), -HALF_H, HALF_H)
          if (d.end === 'a') {
            const ny = Math.min(pos, w.y + w.length - GRID)
            return { ...w, y: ny, length: w.y + w.length - ny }
          }
          return { ...w, length: Math.max(GRID, pos - w.y) }
        })
        const wall = walls.find((w) => w.id === d.id)!
        // Öppningarna följer väggen men får aldrig sticka utanför den.
        const openings = fl.openings.map((o) =>
          o.wallId === wall.id ? clampOpening(o, wall) : o,
        )
        return { walls, openings }
      })
      return
    }

    if (d.kind === 'op-move' || d.kind === 'op-end') {
      const p = unproject(e.clientX, e.clientY)
      patchFloor((fl) => ({
        openings: fl.openings.map((o) => {
          if (o.id !== d.id) return o
          const host = fl.walls.find((w) => w.id === o.wallId)
          if (!host) return o
          const cur = clamp(snap(along(host, p)) - wallStart(host), 0, host.length)
          if (d.kind === 'op-move') {
            // Öppningen glider längs väggen - aldrig utanför.
            const offset = clamp(cur - d.grab, 0, host.length - o.length)
            return { ...o, offset: snap(offset) }
          }
          if (d.end === 'a') {
            const no = Math.min(cur, o.offset + o.length - GRID)
            return { ...o, offset: no, length: o.offset + o.length - no }
          }
          return {
            ...o,
            length: clamp(cur - o.offset, GRID, host.length - o.offset),
          }
        }),
      }))
      return
    }

    if (d.kind === 'marquee') {
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      setMarquee({ x0: d.x0, y0: d.y0, x: e.clientX - rect.left, y: e.clientY - rect.top, additive: d.additive })
      return
    }

    const dx = (e.clientX - d.startX) / zoom
    const dy = (e.clientY - d.startY) / zoom
    const S = -spinRad
    const unTiltY = is3d ? dy / Math.cos((TILT_DEG * Math.PI) / 180) : dy
    const fx = dx * Math.cos(S) - unTiltY * Math.sin(S)
    const fy = dx * Math.sin(S) + unTiltY * Math.cos(S)

    if (d.kind === 'group') {
      // Flera valda flyttas tillsammans. Väggar hålls på rutnätet, så hela
      // gruppen flyttas i hela rutsteg när den innehåller en vägg.
      const hasWall = d.walls.size > 0
      let gx = hasWall ? snap(fx) : fx
      let gy = hasWall ? snap(fy) : fy
      // Hela gruppen stannar vid arbetsytans kant - annars stannade bara den
      // som nådde kanten och gruppen drogs isär.
      let minX = -Infinity
      let maxX = Infinity
      let minY = -Infinity
      let maxY = Infinity
      const room = (o: { x: number; y: number }, w: number, h: number) => {
        minX = Math.max(minX, -HALF_W + w / 2 - o.x)
        maxX = Math.min(maxX, HALF_W - w / 2 - o.x)
        minY = Math.max(minY, -HALF_H + h / 2 - o.y)
        maxY = Math.min(maxY, HALF_H - h / 2 - o.y)
      }
      for (const t of floor.tables) {
        const o = d.tables.get(t.id)
        if (o) room(o, t.w, t.h)
      }
      for (const f of floor.fixtures) {
        const o = d.fixtures.get(f.id)
        if (o) room(o, f.w, f.h)
      }
      for (const w of floor.walls) {
        const o = d.walls.get(w.id)
        if (!o) continue
        const len = w.length
        // En vägg räknas från sin startpunkt, inte sin mitt.
        room({ x: o.x + (w.dir === 'h' ? len / 2 : 0), y: o.y + (w.dir === 'v' ? len / 2 : 0) }, w.dir === 'h' ? len : 0, w.dir === 'v' ? len : 0)
      }
      gx = clamp(gx, minX, maxX)
      gy = clamp(gy, minY, maxY)
      if (hasWall) {
        // Väggar ska ligga kvar på rutnätet: hela rutsteg, inom gränserna.
        gx = clamp(snap(gx), Math.ceil(minX / GRID) * GRID, Math.floor(maxX / GRID) * GRID)
        gy = clamp(snap(gy), Math.ceil(minY / GRID) * GRID, Math.floor(maxY / GRID) * GRID)
      }
      patchFloor((fl) => ({
        tables: fl.tables.map((t) => {
          const o = d.tables.get(t.id)
          if (!o) return t
          return {
            ...t,
            x: clamp(o.x + gx, -HALF_W + t.w / 2, HALF_W - t.w / 2),
            y: clamp(o.y + gy, -HALF_H + t.h / 2, HALF_H - t.h / 2),
          }
        }),
        fixtures: fl.fixtures.map((f) => {
          const o = d.fixtures.get(f.id)
          if (!o) return f
          return {
            ...f,
            x: clamp(o.x + gx, -HALF_W + f.w / 2, HALF_W - f.w / 2),
            y: clamp(o.y + gy, -HALF_H + f.h / 2, HALF_H - f.h / 2),
          }
        }),
        walls: fl.walls.map((w) => {
          const o = d.walls.get(w.id)
          if (!o) return w
          return {
            ...w,
            x: clamp(o.x + gx, -HALF_W, HALF_W - (w.dir === 'h' ? w.length : 0)),
            y: clamp(o.y + gy, -HALF_H, HALF_H - (w.dir === 'v' ? w.length : 0)),
          }
        }),
      }))
      return
    }

    // Ett bord eller kassan: snappa mot de andras kanter och mitt och mot
    // väggarna, med hjälplinjer (håll Cmd/Ctrl för att dra fritt).
    const item = d.kind === 'table' ? floor.tables.find((t) => t.id === d.id) : floor.fixtures.find((f) => f.id === d.id)
    if (!item) return
    let nx = d.origX + fx
    let ny = d.origY + fy
    if (e.metaKey || e.ctrlKey) {
      setGuides([])
    } else {
      const others = [
        ...floor.tables.filter((t) => t.id !== d.id),
        ...floor.fixtures.filter((f) => f.id !== d.id),
      ].map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }))
      const snapped = snapToGuides({ x: nx, y: ny, w: item.w, h: item.h }, others, floor.walls, 8 / zoom)
      nx += snapped.dx
      ny += snapped.dy
      setGuides(snapped.guides)
    }
    const px = clamp(nx, -HALF_W + item.w / 2, HALF_W - item.w / 2)
    const py = clamp(ny, -HALF_H + item.h / 2, HALF_H - item.h / 2)
    if (d.kind === 'table') {
      patchFloor((fl) => ({ tables: fl.tables.map((t) => (t.id === d.id ? { ...t, x: px, y: py } : t)) }))
    } else {
      patchFloor((fl) => ({ fixtures: fl.fixtures.map((f) => (f.id === d.id ? { ...f, x: px, y: py } : f)) }))
    }
  }

  function onScenePointerUp() {
    if (groundDraft) {
      if (groundDraft.w >= GRID && groundDraft.h >= GRID) {
        const g: GroundRect = {
          id: `g${nextId.current++}`,
          x: groundDraft.x,
          y: groundDraft.y,
          w: groundDraft.w,
          h: groundDraft.h,
        }
        // Marken får automatiskt väggar runt om - de ingår.
        const mk = (dir: 'h' | 'v', x: number, y: number, length: number): WallSegment => ({
          id: `w${nextId.current++}`,
          dir,
          x,
          y,
          length,
        })
        patchFloor((fl) => ({
          grounds: [...fl.grounds, g],
          walls: [
            ...fl.walls,
            mk('h', g.x, g.y, g.w),
            mk('h', g.x, g.y + g.h, g.w),
            mk('v', g.x, g.y, g.h),
            mk('v', g.x + g.w, g.y, g.h),
          ],
        }))
        setSelection({ kind: 'ground', id: g.id })
        markDirty()
      }
      setGroundDraft(null)
      return
    }
    if (openingDraft) {
      const host = floor.walls.find((w) => w.id === openingDraft.wallId)
      if (host) {
        // Ett enkelt klick (utan att dra) ger en öppning i standardstorlek,
        // centrerad kring klickpunkten. Tidigare kastades den tyst bort om
        // man inte råkade dra minst en rutnätsruta, vilket fick fönster och
        // kök att kännas trasiga.
        const isClick = openingDraft.length < GRID
        const wanted = isClick
          ? Math.min(OPENING_DEFAULT_LENGTH[openingDraft.kind], host.length)
          : openingDraft.length
        const offset = isClick
          ? clamp(
              snap(openingDraft.offset0 - wanted / 2),
              0,
              Math.max(0, host.length - wanted),
            )
          : openingDraft.offset
        const o: Opening = {
          id: `o${nextId.current++}`,
          kind: openingDraft.kind,
          wallId: openingDraft.wallId,
          offset,
          length: wanted,
        }
        patchFloor((fl) => ({ openings: [...fl.openings, o] }))
        setSelection({ kind: 'opening', id: o.id })
        setTool('select')
        markDirty()
      }
      setOpeningDraft(null)
      return
    }
    if (wallDraft) {
      // Linjeläget hanterar sina klick vid pointerdown (och pekaren som
      // lämnar scenen ska inte avsluta linjen).
      if (wallChain) return
      if (wallDraft.length >= GRID) {
        // Dra = en enskild vägg, som förut.
        const w = addWall(wallDraft)
        setSelection({ kind: 'wall', id: w.id })
        setWallDraft(null)
        return
      }
      // Ett klick utan drag: börja en sammanhängande linje härifrån.
      setWallChain({ startX: wallDraft.x0, startY: wallDraft.y0 })
      return
    }
    if (drag.current?.kind === 'marquee') {
      const box = marquee
      const additive = drag.current.additive
      drag.current = null
      setMarquee(null)
      const tiny = !box || (Math.abs(box.x - box.x0) < 4 && Math.abs(box.y - box.y0) < 4)
      if (tiny) {
        if (!additive) setSelected([])
        return
      }
      const hits = hitsInMarquee(box)
      setSelected((cur) => {
        if (!additive) return hits
        const merged = [...cur]
        for (const h of hits) if (!merged.some((m) => m.kind === h.kind && m.id === h.id)) merged.push(h)
        return merged
      })
      return
    }
    setGuides([])
    if (drag.current) {
      const viewOnly = drag.current.kind === 'rotate' || drag.current.kind === 'pan'
      drag.current = null
      setIsRotating(false)
      // Att rotera eller panorera vyn är ingen innehållsändring - bara
      // riktiga redigeringar ska flagga osparat (och bli ett ångra-steg).
      if (!viewOnly) markDirty()
    }
  }

  /* --- Välj/flytta ------------------------------------------------------ */

  function onElementPointerDown(
    e: ReactPointerEvent,
    kind: 'table' | 'fixture' | 'wall' | 'opening' | 'ground',
    id: string,
    origX = 0,
    origY = 0,
  ) {
    // Panorering (hand, mellanslag, mittenknapp) och Alt+drag (rotation)
    // gäller även ovanpå ett element. Ingen stopPropagation: klicket får
    // bubbla upp till scenens egen pointerdown-hanterare.
    if (isPanGesture(e) || e.altKey || e.button !== 0) return
    if (isDrawTool) return
    e.stopPropagation()
    if (tool === 'erase' && !readOnly) {
      removeByKind(kind, id)
      return
    }
    const item = { kind, id } as SelItem
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Shift-klick (eller Cmd/Ctrl) lägger till eller tar bort ur urvalet.
      setSelected((cur) =>
        cur.some((s) => s.kind === kind && s.id === id)
          ? cur.filter((s) => !(s.kind === kind && s.id === id))
          : [...cur, item],
      )
      return
    }
    const inGroup = selected.length > 1 && isSel(kind, id)
    if (!inGroup) setSelected([item])
    if (inGroup && !readOnly && GROUPABLE.includes(kind)) {
      // Dra i ett av flera valda element = flytta alla valda.
      const pick = (k: SelItem['kind']) => new Set(selected.filter((s) => s.kind === k).map((s) => s.id))
      const ts = pick('table')
      const fs = pick('fixture')
      const ws = pick('wall')
      drag.current = {
        kind: 'group',
        startX: e.clientX,
        startY: e.clientY,
        tables: new Map(floor.tables.filter((t) => ts.has(t.id)).map((t) => [t.id, { x: t.x, y: t.y }])),
        fixtures: new Map(floor.fixtures.filter((f) => fs.has(f.id)).map((f) => [f.id, { x: f.x, y: f.y }])),
        walls: new Map(floor.walls.filter((w) => ws.has(w.id)).map((w) => [w.id, { x: w.x, y: w.y }])),
      }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    // Markera/inspektera går bra i "Se live" - flytta gör det inte. Utan
    // spärren hade ett drag känts trasigt (elementet rör sig inte, eftersom
    // patchFloor redan stoppar själva ändringen) i stället för att tydligt
    // inte gå att göra.
    if (readOnly) return
    if (kind === 'ground') return
    const p = unproject(e.clientX, e.clientY)
    if (kind === 'wall') {
      const w = floor.walls.find((s) => s.id === id)
      if (!w) return
      drag.current = { kind: 'wall-move', id, offX: p.x - w.x, offY: p.y - w.y }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (kind === 'opening') {
      const o = floor.openings.find((op) => op.id === id)
      const host = o && floor.walls.find((w) => w.id === o.wallId)
      if (!o || !host) return
      const cur = along(host, p) - wallStart(host)
      drag.current = { kind: 'op-move', id, grab: cur - o.offset }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    drag.current = { kind, id, startX: e.clientX, startY: e.clientY, origX, origY }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  function onHandlePointerDown(
    e: ReactPointerEvent,
    kind: 'wall' | 'opening',
    id: string,
    end: 'a' | 'b',
  ) {
    if (isPanGesture(e) || e.altKey || readOnly) return
    e.stopPropagation()
    drag.current =
      kind === 'wall' ? { kind: 'wall-end', id, end } : { kind: 'op-end', id, end }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  /** Drar i ett bords kant/ände för att ändra bredd eller djup manuellt. */
  function onTableHandlePointerDown(
    e: ReactPointerEvent,
    id: string,
    edge: 'n' | 's' | 'e' | 'w',
  ) {
    if (isPanGesture(e) || e.altKey || readOnly) return
    e.stopPropagation()
    drag.current = { kind: 'table-resize', id, edge }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  function removeByKind(
    kind: 'table' | 'fixture' | 'wall' | 'opening' | 'ground',
    id: string,
  ) {
    patchFloor((fl) => {
      if (kind === 'table') return { tables: fl.tables.filter((t) => t.id !== id) }
      if (kind === 'wall')
        return {
          walls: fl.walls.filter((w) => w.id !== id),
          openings: fl.openings.filter((o) => o.wallId !== id),
        }
      if (kind === 'opening')
        return { openings: fl.openings.filter((o) => o.id !== id) }
      if (kind === 'fixture')
        return { fixtures: fl.fixtures.filter((f) => f.id !== id) }
      return { grounds: fl.grounds.filter((g) => g.id !== id) }
    })
    setSelection((cur) => (cur && cur.id === id ? null : cur))
    markDirty()
  }

  function updateTable(patch: Partial<TableElement>) {
    if (selection?.kind !== 'table') return
    patchFloor((fl) => ({
      tables: fl.tables.map((t) =>
        t.id === selection.id ? { ...t, ...patch } : t,
      ),
    }))
    markDirty()
  }

  function updateWallLength(delta: number) {
    if (selection?.kind !== 'wall') return
    patchFloor((fl) => {
      const walls = fl.walls.map((w) => {
        if (w.id !== selection.id) return w
        const max = w.dir === 'h' ? HALF_W - w.x : HALF_H - w.y
        return { ...w, length: clamp(w.length + delta, GRID, max) }
      })
      const wall = walls.find((w) => w.id === selection.id)!
      return {
        walls,
        openings: fl.openings.map((o) =>
          o.wallId === wall.id ? clampOpening(o, wall) : o,
        ),
      }
    })
    markDirty()
  }

  function updateOpeningLength(delta: number) {
    if (selection?.kind !== 'opening') return
    patchFloor((fl) => ({
      openings: fl.openings.map((o) => {
        if (o.id !== selection.id) return o
        const host = fl.walls.find((w) => w.id === o.wallId)
        if (!host) return o
        const length = clamp(o.length + delta, GRID, host.length - o.offset)
        return { ...o, length }
      }),
    }))
    markDirty()
  }

  /** Byter ritverktyg och lämnar alltid handläget - man kan inte rita och
   *  rotera samtidigt. */
  function pickTool(t: Tool) {
    setHandMode(false)
    setTool(t)
    finishWallChain()
  }

  function addWall(seg: { dir: 'h' | 'v'; x: number; y: number; length: number }): WallSegment {
    const w: WallSegment = { id: `w${nextId.current++}`, dir: seg.dir, x: seg.x, y: seg.y, length: seg.length }
    patchFloor((fl) => ({ walls: [...fl.walls, w] }))
    markDirty()
    return w
  }

  function finishWallChain() {
    setWallChain(null)
    setWallDraft(null)
  }

  function addCounter(p: { x: number; y: number }) {
    if (readOnly) return
    const f: Fixture = {
      id: `fx${nextId.current++}`,
      type: 'counter',
      label: 'KASSA',
      x: clamp(snap(p.x), -HALF_W + 50, HALF_W - 50),
      y: clamp(snap(p.y), -HALF_H + 20, HALF_H - 20),
      w: 100,
      h: 36,
    }
    patchFloor((fl) => ({ fixtures: [...fl.fixtures, f] }))
    setSelection({ kind: 'fixture', id: f.id })
    setTool('select')
    markDirty()
  }

  /* --- Högerklicksmeny -------------------------------------------------- */

  function onSceneContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (wallChain) finishWallChain()
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-sel-kind]')
    let target: SelItem | null = null
    if (el) {
      target = { kind: el.dataset.selKind as SelItem['kind'], id: el.dataset.selId! } as SelItem
      // Högerklick på något som inte är valt väljer det (som i Figma);
      // högerklick i ett urval behåller hela urvalet.
      if (!isSel(target.kind, target.id)) setSelected([target])
    }
    const p = unproject(e.clientX, e.clientY)
    setMenu({ x: e.clientX, y: e.clientY, target, at: { x: snap(p.x), y: snap(p.y) } })
  }

  function pasteHere(at: { x: number; y: number }) {
    if (!clipboard.current) return
    pasteOnFloor(moveClipsTo(clipboard.current, at), 0)
  }

  interface MenuItem {
    label: string
    shortcut?: string
    danger?: boolean
    disabled?: boolean
    run: () => void
  }

  /** Menyns rader för det som högerklickades (null = tom yta). */
  function menuItems(target: SelItem | null, at: { x: number; y: number }): MenuItem[][] {
    const view: MenuItem[] = [
      { label: 'Markera allt', shortcut: 'Cmd/Ctrl+A', run: () => setSelected([
        ...floor.tables.map((t) => ({ kind: 'table' as const, id: t.id })),
        ...floor.fixtures.map((f) => ({ kind: 'fixture' as const, id: f.id })),
        ...floor.walls.map((w) => ({ kind: 'wall' as const, id: w.id })),
      ]) },
      { label: 'Zooma till allt', shortcut: 'Shift+1', run: () => fitTo(floor) },
    ]
    if (readOnly) return [view]
    const canPaste = Boolean(clipboard.current?.length)
    if (!target) {
      return [
        [
          { label: 'Klistra in här', shortcut: 'Cmd/Ctrl+V', disabled: !canPaste, run: () => pasteHere(at) },
        ],
        [
          { label: 'Fyrkantigt bord här', shortcut: 'T', run: () => addTable('square', at) },
          { label: 'Runt bord här', shortcut: 'R', run: () => addTable('round', at) },
          { label: 'Kassa här', shortcut: 'C', run: () => addCounter(at) },
        ],
        view,
      ]
    }
    const clips = selectionClips()
    // Bara fyrkantiga bord går att vrida - ett runt ser likadant ut.
    const isSquare = (id: string) => floor.tables.find((t) => t.id === id)?.shape === 'square'
    const hasTable =
      selected.some((x) => x.kind === 'table' && isSquare(x.id)) || (target.kind === 'table' && isSquare(target.id))
    const singleTable = selected.length <= 1 && target.kind === 'table'
    return [
      [
        { label: 'Duplicera', shortcut: 'Cmd/Ctrl+D', disabled: clips.length === 0, run: () => pasteOnFloor(clips, 1) },
        { label: 'Kopiera', shortcut: 'Cmd/Ctrl+C', disabled: clips.length === 0, run: () => {
          clipboard.current = clips
          pasteCount.current = 0
          setStatusText('Kopierat - klistra in med Cmd/Ctrl+V eller högerklicka och välj Klistra in här.')
        } },
        { label: 'Klistra in här', shortcut: 'Cmd/Ctrl+V', disabled: !canPaste, run: () => pasteHere(at) },
      ],
      [
        ...(hasTable ? [{ label: 'Vrid 90°', shortcut: 'Shift+R', run: turnSelectedTables }] : []),
        ...(singleTable ? [{ label: `Lägg till ${rowCount} bord i rad åt höger`, run: () => addRow('right') }] : []),
      ],
      [
        { label: selected.length > 1 ? `Ta bort ${selected.length} element` : 'Ta bort', shortcut: 'Delete', danger: true, run: removeSelected },
      ],
      view,
    ].filter((group) => group.length > 0)
  }

  // Första valbara raden får fokus när menyn öppnas, så den går att styra
  // med tangentbordet direkt.
  useEffect(() => {
    if (!menu) return
    document.querySelector<HTMLButtonElement>('.context-menu [role="menuitem"]:not(:disabled)')?.focus()
  }, [menu])

  // Menyn stängs vid klick utanför den.
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('.context-menu')) setMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [menu])

  /**
   * Dra ett bord från verktygsfältet ut på planen: en skugga följer pekaren
   * och bordet hamnar där man släpper. Ett vanligt klick (utan drag) går
   * vidare till knappens onClick och lägger bordet mitt i vyn.
   */
  const suppressToolClick = useRef(false)
  function onTableToolPointerDown(e: ReactPointerEvent, shape: TableShape) {
    if (readOnly || e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let active = false
    const overScene = (ev: PointerEvent) => {
      const r = sceneRef.current?.getBoundingClientRect()
      return Boolean(r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom)
    }
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      active = true
      const p = unproject(ev.clientX, ev.clientY)
      setPlacing({ shape, x: snap(p.x), y: snap(p.y), over: overScene(ev) })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!active) return
      setPlacing(null)
      // Släpps det tillbaka på knappen kommer ett klick efteråt - ignorera det.
      suppressToolClick.current = true
      setTimeout(() => (suppressToolClick.current = false), 0)
      if (!overScene(ev)) return
      const p = unproject(ev.clientX, ev.clientY)
      addTable(shape, { x: snap(p.x), y: snap(p.y) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Mitten av det man ser just nu, i golvkoordinater (snappad). */
  function viewCentre(): { x: number; y: number } {
    const scene = sceneRef.current
    if (!scene) return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
    const rect = scene.getBoundingClientRect()
    const p = unproject(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { x: snap(p.x), y: snap(p.y) }
  }

  function addTable(shape: TableShape, at?: { x: number; y: number }) {
    if (readOnly) return
    // Nästa lediga nummer över alla våningar - tidigare började den på T14
    // och kunde krocka med bord som redan fanns.
    const n = nextTableNumber(floors)
    const seats = shape === 'round' ? 2 : 4
    const size = defaultTableSize(shape, seats)
    const c = at ?? viewCentre()
    // Står redan ett bord där hamnar det nya snett bredvid, inte ovanpå
    // (inte när det släpps på en vald plats - då hamnar det där man släppte).
    for (let i = 0; !at && i < 20 && floor.tables.some((o) => Math.abs(o.x - c.x) < GRID && Math.abs(o.y - c.y) < GRID); i++) {
      c.x += GRID * 2
      c.y += GRID * 2
    }
    const t: TableElement = {
      id: `t${n}-${shape}-${nextId.current++}`,
      label: `T${n}`,
      shape,
      seats,
      zone: 'Mitten',
      x: clamp(c.x, -HALF_W + size.w / 2, HALF_W - size.w / 2),
      y: clamp(c.y, -HALF_H + size.h / 2, HALF_H - size.h / 2),
      rotation: 0,
      ...size,
    }
    patchFloor((fl) => ({ tables: [...fl.tables, t] }))
    setSelection({ kind: 'table', id: t.id })
    setHandMode(false)
    setTool('select')
    markDirty()
  }

  function addFloor() {
    if (readOnly) return
    const f = emptyFloor(floors.length + 1)
    setFloors((prev) => [...prev, f])
    setCurrentFloorId(f.id)
    setSelection(null)
    setHandMode(false)
    setTool('ground')
    fitTo(f)
    markDirty()
  }

  function switchFloor(id: string) {
    setCurrentFloorId(id)
    setSelection(null)
    setWallChain(null)
    setWallDraft(null)
    setOpeningDraft(null)
    setGroundDraft(null)
    const target = floors.find((f) => f.id === id)
    if (target) fitTo(target)
  }

  function removeCurrentFloor() {
    if (readOnly || floors.length <= 1) return
    const rest = floors.filter((f) => f.id !== floor.id)
    setFloors(rest.map((f, i) => ({ ...f, name: `Våning ${i + 1}` })))
    setCurrentFloorId(rest[0].id)
    setSelection(null)
    markDirty()
  }

  /* --- Kortkommandon ---------------------------------------------------- */

  /** De valda elementen som klipp - bord, kassa och väggar går att kopiera. */
  function selectionClips(): Clip[] {
    const out: Clip[] = []
    for (const sel of selected) {
      if (sel.kind === 'table') {
        const t = floor.tables.find((x) => x.id === sel.id)
        if (t) out.push({ kind: 'table', table: t })
      } else if (sel.kind === 'fixture') {
        const f = floor.fixtures.find((x) => x.id === sel.id)
        if (f) out.push({ kind: 'fixture', fixture: f })
      } else if (sel.kind === 'wall') {
        const w = floor.walls.find((x) => x.id === sel.id)
        if (w) out.push({ kind: 'wall', wall: w })
      }
    }
    return out
  }

  /** Klistrar in (eller duplicerar) klippen på den här våningen och väljer kopiorna. */
  function pasteOnFloor(clips: Clip[], times: number) {
    if (readOnly || clips.length === 0) return
    let n = nextTableNumber(floors)
    const outs = clips.map((clip) =>
      pasteClip(
        clip,
        times,
        () => `${clip.kind === 'wall' ? 'w' : clip.kind === 'fixture' ? 'fx' : 't'}${nextId.current++}-kopia`,
        () => `T${n++}`,
      ),
    )
    const tables = outs.flatMap((o) => (o.kind === 'table' ? [o.table] : []))
    const fixtures = outs.flatMap((o) => (o.kind === 'fixture' ? [o.fixture] : []))
    const walls = outs.flatMap((o) => (o.kind === 'wall' ? [o.wall] : []))
    patchFloor((fl) => ({
      tables: [...fl.tables, ...tables],
      fixtures: [...fl.fixtures, ...fixtures],
      walls: [...fl.walls, ...walls],
    }))
    setSelected([
      ...tables.map((t) => ({ kind: 'table' as const, id: t.id })),
      ...fixtures.map((f) => ({ kind: 'fixture' as const, id: f.id })),
      ...walls.map((w) => ({ kind: 'wall' as const, id: w.id })),
    ])
    pickTool('select')
    markDirty()
  }

  /** Pilknapparna: flytta allt valt ett rutsteg (Shift: fem) i skärmens riktning. */
  function nudgeSelection(dx: number, dy: number, big: boolean) {
    if (selected.length === 0 || readOnly) return
    const d = nudgeDelta(dx, dy, spin, GRID * (big ? 5 : 1))
    const ids = (k: SelItem['kind']) => new Set(selected.filter((s) => s.kind === k).map((s) => s.id))
    const ts = ids('table')
    const fs = ids('fixture')
    const ws = ids('wall')
    const os = ids('opening')
    patchFloor((fl) => ({
      tables: fl.tables.map((t) =>
        !ts.has(t.id)
          ? t
          : {
              ...t,
              x: clamp(t.x + d.x, -HALF_W + t.w / 2, HALF_W - t.w / 2),
              y: clamp(t.y + d.y, -HALF_H + t.h / 2, HALF_H - t.h / 2),
            },
      ),
      fixtures: fl.fixtures.map((f) =>
        !fs.has(f.id)
          ? f
          : {
              ...f,
              x: clamp(f.x + d.x, -HALF_W + f.w / 2, HALF_W - f.w / 2),
              y: clamp(f.y + d.y, -HALF_H + f.h / 2, HALF_H - f.h / 2),
            },
      ),
      walls: fl.walls.map((w) =>
        !ws.has(w.id)
          ? w
          : {
              ...w,
              x: clamp(w.x + d.x, -HALF_W, HALF_W - (w.dir === 'h' ? w.length : 0)),
              y: clamp(w.y + d.y, -HALF_H, HALF_H - (w.dir === 'v' ? w.length : 0)),
            },
      ),
      // En öppning kan bara glida längs sin vägg.
      openings: fl.openings.map((o) => {
        if (!os.has(o.id)) return o
        const host = fl.walls.find((w) => w.id === o.wallId)
        if (!host) return o
        const step = host.dir === 'h' ? d.x : d.y
        return { ...o, offset: clamp(o.offset + step, 0, host.length - o.length) }
      }),
    }))
    markDirty()
  }

  /** Tar bort allt valt i ett enda ångra-steg. */
  function removeSelected() {
    if (readOnly || selected.length === 0) return
    for (const s of selected) removeByKind(s.kind, s.id)
    setSelected([])
  }

  /** Vrider de valda borden 90° (Shift+R). */
  function turnSelectedTables() {
    if (readOnly) return
    const ts = new Set(selected.filter((s) => s.kind === 'table').map((s) => s.id))
    if (ts.size === 0) {
      if (selected.length > 0) warn('Bara bord går att vrida.')
      return
    }
    patchFloor((fl) => ({ tables: fl.tables.map((t) => (ts.has(t.id) ? turnTable(t) : t)) }))
    markDirty()
  }

  /** "Upprepa i rad": nya bord efter det valda, åt höger eller nedåt på skärmen. */
  function addRow(screenDir: 'right' | 'down') {
    if (readOnly || !selectedTable) return
    const unit = nudgeDelta(screenDir === 'right' ? 1 : 0, screenDir === 'down' ? 1 : 0, spin, 1)
    let n = nextTableNumber(floors)
    const row = tableRow(
      selectedTable,
      rowCount,
      unit,
      GRID * 2,
      () => `t${nextId.current++}-rad`,
      () => `T${n++}`,
    )
    if (row.length === 0) {
      warn('Det finns ingen plats för fler bord åt det hållet.')
      return
    }
    if (row.length < rowCount) warn(`Bara ${row.length} bord fick plats innan arbetsytans kant.`)
    patchFloor((fl) => ({ tables: [...fl.tables, ...row] }))
    setSelected([selectedTable, ...row].map((t) => ({ kind: 'table' as const, id: t.id })))
    markDirty()
  }

  function runAction(action: EditorAction, e: KeyboardEvent) {
    switch (action.type) {
      case 'undo':
        e.preventDefault()
        applyHistory(undo(history.current))
        return
      case 'redo':
        e.preventDefault()
        applyHistory(redo(history.current))
        return
      case 'delete':
        if (selected.length === 0 || readOnly) return
        e.preventDefault()
        removeSelected()
        return
      case 'escape':
        if (showHelp) setShowHelp(false)
        else if (wallDraft || openingDraft || groundDraft || wallChain) {
          // Avslutar en vägglinje (det ritade blir kvar) eller avbryter ett utkast.
          finishWallChain()
          setOpeningDraft(null)
          setGroundDraft(null)
        } else if (handMode || tool !== 'select') pickTool('select')
        else setSelection(null)
        return
      case 'confirm':
        if (!wallChain) return
        e.preventDefault()
        finishWallChain()
        return
      case 'nudge':
        if (selected.length === 0) return
        e.preventDefault() // annars scrollar sidan
        nudgeSelection(action.dx, action.dy, action.big)
        return
      case 'duplicate': {
        e.preventDefault() // Cmd+D är annars "lägg till bokmärke"
        const clips = selectionClips()
        if (clips.length > 0) pasteOnFloor(clips, 1)
        else if (selected.length > 0) warn('Bord, kassan och väggar går att duplicera - fönster, dörrar och mark inte än.')
        return
      }
      case 'copy': {
        const clips = selectionClips()
        if (clips.length === 0) return
        e.preventDefault()
        clipboard.current = clips
        pasteCount.current = 0
        setStatusText('Kopierat - klistra in med Cmd/Ctrl+V, även på en annan våning.')
        return
      }
      case 'paste':
        if (!clipboard.current || readOnly) return
        e.preventDefault()
        pasteCount.current += 1
        pasteOnFloor(clipboard.current, pasteCount.current)
        return
      case 'tool':
        chooseTool(action.tool)
        return
      case 'zoom-fit':
        e.preventDefault()
        fitTo(floor)
        return
      case 'zoom-100':
        e.preventDefault()
        zoomBy(1 / (zoom || 1))
        return
      case 'zoom-in':
        e.preventDefault()
        zoomBy(1.2)
        return
      case 'zoom-out':
        e.preventDefault()
        zoomBy(1 / 1.2)
        return
      case 'help':
        setShowHelp((v) => !v)
        return
      case 'rotate':
        turnSelectedTables()
        return
      case 'select-all':
        e.preventDefault()
        setSelected([
          ...floor.tables.map((t) => ({ kind: 'table' as const, id: t.id })),
          ...floor.fixtures.map((f) => ({ kind: 'fixture' as const, id: f.id })),
          ...floor.walls.map((w) => ({ kind: 'wall' as const, id: w.id })),
        ])
        return
    }
  }

  /** Verktyg via knapp eller bokstav - samma väg för båda. */
  function chooseTool(t: ShortcutTool) {
    if (t === 'hand') {
      setTool('select')
      setHandMode(true)
      return
    }
    if (t === 'select') {
      pickTool('select')
      return
    }
    if (readOnly) return
    if (t === 'add-square') addTable('square')
    else if (t === 'add-round') addTable('round')
    else pickTool(t)
  }

  // Lyssnaren registreras en gång; den anropar alltid den senaste versionen
  // av hanteraren (som ser aktuellt urval, verktyg och historik).
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e: KeyboardEvent) => {
    if (showVersions || isTypingTarget(e.target)) return
    if (menu) {
      // Med menyn öppen: Esc stänger, pilarna flyttar mellan raderna och
      // Enter/mellanslag väljer raden (knappens eget beteende).
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenu(null)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]:not(:disabled)')]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
        items[next]?.focus()
        return
      }
      if (e.key === 'Enter' || e.code === 'Space' || e.key === 'Tab') return
      setMenu(null)
    }
    if (e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
      // Håll inne mellanslag = tillfälligt handverktyg, som i Figma.
      e.preventDefault()
      if (!e.repeat) setSpaceDown(true)
      return
    }
    const action = actionForKey(e)
    if (action) runAction(action, e)
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => onKey.current(e)
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceDown(false)
      }
    }
    const reset = () => setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])

  async function refreshVersionLabel() {
    const loc = getStoredLocationId()
    if (loc) setVersionLabel(await versionLabelFor(loc))
  }

  /**
   * Växlar canvasen till att visa den publicerade, GÄLLANDE versionen i
   * stället för utkastet - skrivskyddat. Byter tillfälligt ut `floors`/
   * `currentFloorId` (som resten av sidan redan är byggd kring) och sparar
   * undan utkastet i `draftBackup` så "Se utkast" kan återställa det exakt.
   */
  async function showLive() {
    if (!locationId) return
    setLiveError(null)
    setLiveLoading(true)
    try {
      const versions = await listLayoutVersions(locationId)
      const current = versions.find((v) => v.isCurrent)
      if (!current) {
        setLiveError(
          'Ingen version är aktiv än - publicera och aktivera en version ' +
            'under Versioner först.',
        )
        return
      }
      const liveFloors = toFloors(current.elements)
      draftBackup.current = { floors, currentFloorId }
      setFloors(liveFloors)
      setCurrentFloorId(liveFloors[0].id)
      setSelection(null)
      setTool('select')
      setWallDraft(null)
      setOpeningDraft(null)
      setGroundDraft(null)
      setLiveVersionLabel(current.label)
      setViewMode('live')
    } catch (err) {
      setLiveError(
        errorText(err, 'Kunde inte hämta den publicerade versionen.'),
      )
    } finally {
      setLiveLoading(false)
    }
  }

  /** Växlar tillbaka till utkastet - exakt som det låg innan "Se live". */
  function showDraft() {
    if (draftBackup.current) {
      setFloors(draftBackup.current.floors)
      setCurrentFloorId(draftBackup.current.currentFloorId)
      draftBackup.current = null
    }
    setSelection(null)
    setLiveError(null)
    setViewMode('draft')
  }

  function requireLocation(): string | null {
    if (locationId) return locationId
    setLayoutError(
      'Ingen plats är sparad än - skapa restaurangens plats under ' +
        'Inställningar innan layouten kan sparas.',
    )
    return null
  }

  /** Skriver utkastet till API:t. Returnerar false om något gick fel. */
  async function saveDraft(): Promise<boolean> {
    // Knappen är dold i "Se live"-läget, men gardera ändå - annars hade den
    // skrivit över det riktiga utkastet med den låsta live-vyns innehåll.
    if (readOnly) return false
    const loc = requireLocation()
    if (!loc) return false
    setLayoutError(null)
    setSaving(true)
    try {
      const result = await saveLayout(loc, floors)
      const serverId = (localId: string) => result.idMap.get(localId) ?? localId
      // Läs in serverns svar igen: nyskapade element (och våningar) får sina
      // riktiga elementId, vilket nästa sparning behöver för att se dem som
      // befintliga istället för att skapa dubbletter.
      const reloaded = toFloors(result.elements)
      // I platt reservläge finns bara första våningen på servern - de andra
      // behålls lokalt så att inget ritat försvinner.
      const next = result.flat ? [reloaded[0], ...floors.slice(1)] : reloaded
      setFloors(next)
      // Elementen har fått serverns id:n - äldre ångra-steg har de lokala
      // och skulle återskapa dubbletter vid nästa sparning. Historiken
      // börjar därför om från det sparade läget.
      resetHistory(next)
      const current = serverId(floor.id)
      setCurrentFloorId(next.some((f) => f.id === current) ? current : next[0].id)
      setSelection(null)
      setStatusText(
        `Utkast sparat - ${result.created} nya, ${result.updated} ändrade, ` +
          `${result.deleted} borttagna.` +
          (result.flat && floors.length > 1
            ? ` Servern saknar våningsstöd - bara ${floors[0].name} sparades.`
            : ''),
      )
      return true
    } catch (err) {
      setLayoutError(
        errorText(err, 'Kunde inte spara utkastet.'),
      )
      return false
    } finally {
      setSaving(false)
    }
  }

  /**
   * Sparar utkastet, fryser det till en numrerad version, och försöker
   * aktivera den versionen direkt - "Publicera" ska kännas som "gör den
   * här skarp", inte kräva ett extra besök i Versioner för det vanliga
   * fallet. Aktiveringen är serverns beslut, inte vårt: saknas en gällande
   * version blir det omedelbart, men finns redan en schemalägger API:t
   * bytet en bit fram i tiden istället (samma regel som att aktivera
   * manuellt under Versioner - den går inte att kringgå härifrån). Hur
   * långt fram är miljöberoende - bara 5 minuter i dev, annars 28 dagar
   * (bekräftat av backend-teamet 2026-09-29) - därför visas alltid det
   * riktiga datumet från `cutoverAt`, aldrig ett hårdkodat "fyra veckor".
   *
   * Ordningen save->publish är viktig: publish kopierar det som ligger i
   * utkastet på servern, så osparade ändringar skulle annars inte komma
   * med i versionen.
   */
  async function publish() {
    const loc = requireLocation()
    if (!loc) return
    if (!(await saveDraft())) return
    setPublishing(true)
    try {
      const snapshot = await publishLayout(loc)
      try {
        const activation = await activateLayoutVersion(loc, snapshot.version)
        await refreshVersionLabel()
        setStatusText(
          activation.status === 'active'
            ? `Publicerad och aktiverad som version ${snapshot.version} - gäller nu.`
            : `Publicerad som version ${snapshot.version}. En annan version gäller ` +
                `redan, så bytet sker ${formatMoment(activation.cutoverAt)} istället för direkt.`,
        )
      } catch (activateErr) {
        // Versionen finns - bara aktiveringen misslyckades (t.ex. saknad
        // behörighet, eller ett annat versionsbyte redan inbokat). Säg det
        // tydligt så ingen tror att publiceringen också gick fel; den kan
        // fortfarande aktiveras manuellt. Felmeddelandet för "redan
        // inbokat" (409) ger redan sin egen vägledning - dubblera den inte.
        const detail =
          errorText(activateErr, 'Okänt fel.')
        const guidance = /aktivera/i.test(detail)
          ? ''
          : ' Aktivera den manuellt under Versioner.'
        setLayoutError(
          `Publicerad som version ${snapshot.version}, men aktiveringen ` +
            `misslyckades: ${detail}${guidance}`,
        )
      }
    } catch (err) {
      setLayoutError(
        `Utkastet sparades, men publiceringen misslyckades: ${errorText(err, 'Kunde inte publicera layouten.')}`,
      )
    } finally {
      setPublishing(false)
    }
  }

  /* --- Render ----------------------------------------------------------- */

  const drawnGrounds: (GroundRect & { draft?: boolean })[] = groundDraft
    ? [...floor.grounds, { id: '__gdraft', ...groundDraft, draft: true }]
    : floor.grounds
  const drawnWalls: (WallSegment & { draft?: boolean })[] = wallDraft
    ? [...floor.walls, { id: '__wdraft', ...wallDraft, draft: true }]
    : floor.walls
  const drawnOpenings: (Opening & { draft?: boolean })[] = openingDraft
    ? [
        ...floor.openings,
        { id: '__odraft', ...openingDraft, draft: true },
      ]
    : floor.openings

  const floorIsEmpty =
    floor.grounds.length === 0 &&
    floor.walls.length === 0 &&
    floor.tables.length === 0 &&
    floor.fixtures.length === 0

  const loweredById = new Map(drawnWalls.map((w) => [w.id, isLowered(w)]))

  return (
    <>
      <AdminTopbar
        title="Layout"
        actions={
          <span className="row-actions">
            <span className="cell-muted">{versionLabel}</span>
            <button
              type="button"
              className="btn outline"
              disabled={!locationId}
              onClick={() => setShowVersions(true)}
            >
              Versioner
            </button>
            <button
              type="button"
              className="btn outline"
              disabled={!locationId || liveLoading}
              onClick={readOnly ? showDraft : showLive}
            >
              {liveLoading ? 'Hämtar…' : readOnly ? 'Se utkast' : 'Se live'}
            </button>
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="btn outline"
                  disabled={saving || publishing}
                  onClick={saveDraft}
                >
                  {saving && !publishing ? 'Sparar…' : 'Spara utkast'}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  data-tour="layout-publish"
                  disabled={saving || publishing || !canActivate}
                  title={
                    canActivate
                      ? undefined
                      : 'Bara ägare och systemadmin kan publicera och aktivera en layout.'
                  }
                  onClick={publish}
                >
                  {publishing ? 'Publicerar…' : 'Publicera layout'}
                </button>
              </>
            )}
          </span>
        }
      />
      <div className="admin-main">
        {!locationId && !resolvingLocation && (
          <p className="form-error" role="alert">
            Layouten sparas inte: ingen restaurangplats är skapad än. Gå till
            Inställningar och spara restaurangprofilen först - layouten lagras
            per plats i API:t. Det du ritar här försvinner vid omladdning tills
            dess.
          </p>
        )}
        {layoutError && (
          <p className="form-error" role="alert">
            {layoutError}
          </p>
        )}
        {liveError && (
          <p className="form-error" role="alert">
            {liveError}
          </p>
        )}
        {readOnly && (
          <p className="layout-viewmode-banner">
            Du tittar på den publicerade, gällande versionen
            {liveVersionLabel ? ` (${liveVersionLabel})` : ''} - skrivskyddat.{' '}
            <button type="button" className="link-action" onClick={showDraft}>
              Tillbaka till utkastet
            </button>
          </p>
        )}
        <div className="editor-row">
          <div className="admin-card editor-toolbar" data-tour="layout-tools">
            <ToolButton icon="tool-select" caption="Välj" title="Välj, flytta och ändra storlek" shortcut={keyForTool('select')} active={tool === 'select' && !handMode} onClick={() => chooseTool('select')} />
            <ToolButton icon="tool-hand" caption="Hand" title="Hand - dra för att panorera (eller håll inne mellanslag)" shortcut={keyForTool('hand')} active={handMode} onClick={() => (handMode ? chooseTool('select') : chooseTool('hand'))} />
            <ToolButton icon="tool-floor" caption="Mark" title="Rita mark - väggar skapas runt om automatiskt" shortcut={keyForTool('ground')} active={tool === 'ground'} disabled={readOnly} onClick={() => chooseTool('ground')} />
            <ToolButton icon="tool-wall" caption="Vägg" title="Rita väggar - klicka per hörn (dubbelklick avslutar), eller dra för en enskild vägg" shortcut={keyForTool('wall')} active={tool === 'wall'} disabled={readOnly} onClick={() => chooseTool('wall')} />
            <ToolButton icon="tool-window" caption="Fönster" title="Fönster - placeras på en vägg" shortcut={keyForTool('window')} active={tool === 'window'} disabled={readOnly} onClick={() => chooseTool('window')} />
            <ToolButton icon="tool-entrance" caption="Entré" title="Entré - placeras på en vägg" shortcut={keyForTool('entrance')} active={tool === 'entrance'} disabled={readOnly} onClick={() => chooseTool('entrance')} />
            <ToolButton icon="tool-kitchen" caption="Kök" title="Kökets ingång - placeras på en vägg" shortcut={keyForTool('kitchen')} active={tool === 'kitchen'} disabled={readOnly} onClick={() => chooseTool('kitchen')} />
            <ToolButton icon="tool-checkout" caption="Kassa" title="Placera kassan - klicka" shortcut={keyForTool('counter')} active={tool === 'counter'} disabled={readOnly} onClick={() => chooseTool('counter')} />
            <ToolButton icon="table-square" caption="Fyrkant" title="Fyrkantigt bord - klicka, eller dra ut det på planen" shortcut={keyForTool('add-square')} active={placing?.shape === 'square'} disabled={readOnly} onPointerDown={(e) => onTableToolPointerDown(e, 'square')} onClick={() => !suppressToolClick.current && chooseTool('add-square')} />
            <ToolButton icon="table-round" caption="Runt" title="Runt bord - klicka, eller dra ut det på planen" shortcut={keyForTool('add-round')} active={placing?.shape === 'round'} disabled={readOnly} onPointerDown={(e) => onTableToolPointerDown(e, 'round')} onClick={() => !suppressToolClick.current && chooseTool('add-round')} />
            <ToolButton icon="trash" caption="Radera" title="Radera - klicka på ett element (eller välj och tryck Delete)" active={tool === 'erase'} disabled={readOnly} onClick={() => { setHandMode(false); setTool((t) => (t === 'erase' ? 'select' : 'erase')) }} />
          </div>

          <div
            ref={sceneRef}
            className={[
              'floor-scene',
              isDrawTool && !handMode && !spaceDown ? 'tool-draw' : '',
              handMode || spaceDown ? (isRotating ? 'tool-hand-grabbing' : 'tool-hand') : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onPointerDown={onScenePointerDown}
            onPointerMove={onScenePointerMove}
            onPointerUp={onScenePointerUp}
            onPointerLeave={onScenePointerUp}
            onContextMenu={onSceneContextMenu}
          >
            <div className="floor-tabs" onPointerDown={(e) => e.stopPropagation()}>
              {floors.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={f.id === floor.id ? 'active' : ''}
                  onClick={() => switchFloor(f.id)}
                >
                  {f.name}
                </button>
              ))}
              <button type="button" className="add" title="Lägg till våning (börjar tom)" onClick={addFloor}>
                +
              </button>
            </div>

            <div className="scene-controls" onPointerDown={(e) => e.stopPropagation()}>
              {!readOnly && (
                <div className="view-toggle">
                  <button type="button" title="Ångra (Cmd/Ctrl+Z)" aria-label="Ångra" disabled={!canUndo} onClick={() => applyHistory(undo(history.current))}>
                    <Icon name="undo" size={18} />
                  </button>
                  <button type="button" title="Gör om (Cmd/Ctrl+Shift+Z)" aria-label="Gör om" disabled={!canRedo} onClick={() => applyHistory(redo(history.current))}>
                    <Icon name="redo" size={18} />
                  </button>
                </div>
              )}
              <div className="view-toggle">
                <button type="button" title="Zooma ut (Cmd/Ctrl+-)" aria-label="Zooma ut" onClick={() => zoomBy(1 / 1.2)}>
                  −
                </button>
                <button type="button" className="zoom-value" title="Zooma till allt (Shift+1)" onClick={() => fitTo(floor)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" title="Zooma in (Cmd/Ctrl++)" aria-label="Zooma in" onClick={() => zoomBy(1.2)}>
                  +
                </button>
              </div>
              <div className="view-toggle">
                <button type="button" className="view-icon" title="Rotera vyn moturs (eller Alt + dra)" aria-label="Rotera moturs" onClick={() => setSpin((s) => s - 45)}>
                  ⟲
                </button>
                <button type="button" className="view-icon" title="Rotera vyn medurs (eller Alt + dra)" aria-label="Rotera medurs" onClick={() => setSpin((s) => s + 45)}>
                  ⟳
                </button>
              </div>
              <div className="view-toggle">
                <button
                  type="button"
                  className={showHelp ? 'active' : ''}
                  title="Kortkommandon (?)"
                  aria-label="Kortkommandon"
                  aria-pressed={showHelp}
                  onClick={() => setShowHelp((v) => !v)}
                >
                  ?
                </button>
              </div>
              <div className="view-toggle">
                <button type="button" className={is3d ? '' : 'active'} onClick={() => setIs3d(false)}>
                  2D
                </button>
                <button type="button" className={is3d ? 'active' : ''} onClick={() => setIs3d(true)}>
                  3D
                </button>
              </div>
              {floorIndex > 0 && (
                <div className="view-toggle">
                  <button
                    type="button"
                    className={showFloorBelow ? 'active' : ''}
                    title="Visa våningen under som skugga, för att rikta in t.ex. trappor"
                    onClick={() => setShowFloorBelow((v) => !v)}
                  >
                    Våning under
                  </button>
                </div>
              )}
            </div>

            <div
              className={isRotating ? 'floor-world no-anim' : 'floor-world'}
              style={{
                ['--tilt' as string]: is3d ? `${TILT_DEG}deg` : '0deg',
                ['--spin' as string]: `${spin}deg`,
                ['--zoom' as string]: zoom,
                ['--pan-x' as string]: `${pan.x}px`,
                ['--pan-y' as string]: `${pan.y}px`,
              }}
            >
              <div
                className="floor-plane"
                style={{
                  width: WORKSPACE.w,
                  height: WORKSPACE.h,
                  transform: `translate(${tx}px, ${ty}px)`,
                }}
              >
                {belowFloor && (
                  <div className="floor-ghost" aria-hidden="true">
                    {/* Bara väggarna - de byggs neråt i Z-led via CSS
                        (.floor-ghost .seg { --lift }), som om man tittade
                        rakt ner genom golvet på strukturen under. */}
                    {belowFloor.walls.map((w) => (
                      <WallEl
                        key={w.id}
                        wall={w}
                        lowered={false}
                        selected={false}
                        showHandles={false}
                        onPointerDown={() => {}}
                        onHandlePointerDown={() => {}}
                      />
                    ))}
                  </div>
                )}

                {drawnGrounds.map((g) => (
                  <div
                    key={g.id}
                    className={[
                      'ground',
                      isSel('ground', g.id) ? 'selected' : '',
                      g.draft ? 'draft' : '',
                    ].join(' ')}
                    style={{ left: g.x + HALF_W, top: g.y + HALF_H, width: g.w, height: g.h }}
                    data-sel-kind={g.draft ? undefined : 'ground'}
                    data-sel-id={g.draft ? undefined : g.id}
                    onPointerDown={(e) => onElementPointerDown(e, 'ground', g.id)}
                  />
                ))}

                {drawnWalls.map((w) => (
                  <WallEl
                    key={w.id}
                    wall={w}
                    lowered={loweredById.get(w.id) ?? false}
                    selected={isSel('wall', w.id)}
                    selId={w.draft ? undefined : w.id}
                    showHandles={
                      !readOnly &&
                      tool === 'select' &&
                      selection?.kind === 'wall' &&
                      selection.id === w.id
                    }
                    onPointerDown={(e) => onElementPointerDown(e, 'wall', w.id)}
                    onHandlePointerDown={(e, end) =>
                      onHandlePointerDown(e, 'wall', w.id, end)
                    }
                  />
                ))}

                {drawnOpenings.map((o) => {
                  const host = drawnWalls.find((w) => w.id === o.wallId)
                  if (!host) return null
                  return (
                    <OpeningEl
                      key={o.id}
                      opening={o}
                      wall={host}
                      lowered={loweredById.get(host.id) ?? false}
                      selected={isSel('opening', o.id)}
                      showHandles={
                        !readOnly &&
                        tool === 'select' &&
                        selection?.kind === 'opening' &&
                        selection.id === o.id
                      }
                      onPointerDown={(e) => onElementPointerDown(e, 'opening', o.id)}
                      onHandlePointerDown={(e, end) =>
                        onHandlePointerDown(e, 'opening', o.id, end)
                      }
                    />
                  )
                })}

                {floor.fixtures.map((f) => (
                  <div
                    key={f.id}
                    className={isSel('fixture', f.id) ? 'fixture selected' : 'fixture'}
                    data-sel-kind="fixture"
                    data-sel-id={f.id}
                    style={{
                      left: f.x - f.w / 2 + HALF_W,
                      top: f.y - f.h / 2 + HALF_H,
                      width: f.w,
                      height: f.h,
                      ['--fh' as string]: `${COUNTER_HEIGHT}px`,
                    }}
                    onPointerDown={(e) => onElementPointerDown(e, 'fixture', f.id, f.x, f.y)}
                  >
                    <div className="fx-face back" />
                    <div className="fx-face left" />
                    <div className="fx-face right" />
                    <div className="fx-face front" />
                    <div className="fx-top" />
                    <div className="fx-register">
                      <div className="fxr-face back" />
                      <div className="fxr-face left" />
                      <div className="fxr-face right" />
                      <div className="fxr-face front" />
                      <div className="fxr-top" />
                    </div>
                    <div className="seg-tag kassa-tag">
                      <span>{f.label}</span>
                    </div>
                  </div>
                ))}

                {floor.tables.map((t) => {
                  const size = tableSize(t)
                  return (
                    <div
                      key={t.id}
                      className={[
                        'table-el',
                        t.shape,
                        isSel('table', t.id) ? 'selected' : '',
                      ].join(' ')}
                      data-sel-kind="table"
                      data-sel-id={t.id}
                      style={{
                        left: t.x - size.w / 2 + HALF_W,
                        top: t.y - size.h / 2 + HALF_H,
                        width: size.w,
                        height: size.h,
                        ['--th' as string]: `${TABLE_HEIGHT}px`,
                      }}
                      onPointerDown={(e) => onElementPointerDown(e, 'table', t.id, t.x, t.y)}
                    >
                      {/* En stol per plats, inskjuten under bordet med ryggstödet
                          utåt - antalet syns direkt i planen. Bara bild: inte klickbar. */}
                      {seatPositions(t).map((s, i) => (
                        <div
                          key={i}
                          className="table-seat"
                          aria-hidden="true"
                          style={{
                            left: size.w / 2 + s.x - SEAT_W / 2,
                            top: size.h / 2 + s.y - SEAT_D / 2,
                            width: SEAT_W,
                            height: SEAT_D,
                            transform: `rotate(${s.rot}deg)`,
                          }}
                        >
                          <div className="table-seat-top" />
                          <div className="table-seat-back" />
                        </div>
                      ))}
                      <div className="table-base" />
                      <div className="table-body">
                        {t.shape === 'square' ? (
                          <>
                            <div className="table-face back" />
                            <div className="table-face left" />
                            <div className="table-face right" />
                            <div className="table-face front" />
                          </>
                        ) : (
                          <div className="table-face side-ring" />
                        )}
                        <div className="table-top">
                          <span className="table-labels">
                            <span className="table-label">{t.label}</span>
                            {/* Platsantalet i samma stil som bordsnumret: T3 / P4. */}
                            <span className="table-seats">P{t.seats}</span>
                          </span>
                        </div>
                      </div>
                      {!readOnly &&
                        tool === 'select' &&
                        selection?.kind === 'table' &&
                        selection.id === t.id && (
                          <>
                            <div
                              className="table-handle n"
                              title="Dra för att ändra djup"
                              onPointerDown={(e) => onTableHandlePointerDown(e, t.id, 'n')}
                            />
                            <div
                              className="table-handle s"
                              title="Dra för att ändra djup"
                              onPointerDown={(e) => onTableHandlePointerDown(e, t.id, 's')}
                            />
                            <div
                              className="table-handle e"
                              title="Dra för att ändra bredd"
                              onPointerDown={(e) => onTableHandlePointerDown(e, t.id, 'e')}
                            />
                            <div
                              className="table-handle w"
                              title="Dra för att ändra bredd"
                              onPointerDown={(e) => onTableHandlePointerDown(e, t.id, 'w')}
                            />
                          </>
                        )}
                    </div>
                  )
                })}

                {/* Hjälplinjer medan ett bord eller kassan dras. */}
                {guides.map((g, i) => (
                  <div
                    key={i}
                    className="guide-line"
                    aria-hidden="true"
                    style={
                      g.axis === 'x'
                        ? { left: g.at + HALF_W, top: g.from + HALF_H, width: 1.5 / zoom, height: g.to - g.from }
                        : { left: g.from + HALF_W, top: g.at + HALF_H, width: g.to - g.from, height: 1.5 / zoom }
                    }
                  />
                ))}

                {/* Skugga av bordet som dras ut från verktygsfältet. */}
                {placing?.over &&
                  (() => {
                    const size = defaultTableSize(placing.shape, placing.shape === 'round' ? 2 : 4)
                    return (
                      <div
                        className={`table-ghost ${placing.shape}`}
                        aria-hidden="true"
                        style={{
                          left: placing.x - size.w / 2 + HALF_W,
                          top: placing.y - size.h / 2 + HALF_H,
                          width: size.w,
                          height: size.h,
                        }}
                      />
                    )
                  })()}
              </div>
            </div>

            {(() => {
              // Mått i meter medan man ritar, eller drar i ett handtag.
              const dk = drag.current?.kind
              const text =
                wallDraft && wallDraft.length > 0
                  ? formatMetres(wallDraft.length)
                  : groundDraft && groundDraft.w > 0
                    ? formatSize(groundDraft.w, groundDraft.h)
                    : openingDraft && openingDraft.length > 0
                      ? formatMetres(openingDraft.length)
                      : dk === 'table-resize' && selectedTable
                        ? formatSize(selectedTable.w, selectedTable.h)
                        : dk === 'wall-end' && selectedWall
                          ? formatMetres(selectedWall.length)
                          : dk === 'op-end' && selectedOpening
                            ? formatMetres(selectedOpening.length)
                            : null
              return text && pointer ? (
                <div className="measure-tag" aria-live="polite" style={{ left: pointer.x + 14, top: pointer.y + 14 }}>
                  {text}
                </div>
              ) : null
            })()}

            {marquee && (
              <div
                className="marquee"
                aria-hidden="true"
                style={{
                  left: Math.min(marquee.x0, marquee.x),
                  top: Math.min(marquee.y0, marquee.y),
                  width: Math.abs(marquee.x - marquee.x0),
                  height: Math.abs(marquee.y - marquee.y0),
                }}
              />
            )}

            {floorIsEmpty && (
              <div className="scene-empty">
                <p>
                  <strong>{floor.name} är tom.</strong>
                  <br />
                  Börja i mitten - origo (0,0) - med <b>Mark</b>-verktyget och
                  rita golvet. Väggar skapas runt marken automatiskt.
                </p>
              </div>
            )}

            {showHelp && <ShortcutSheet onClose={() => setShowHelp(false)} />}

            <p className={drawWarning ? 'scene-hint warning' : 'scene-hint'}>
              {drawWarning
                ? drawWarning
                : tool === 'ground'
                  ? 'Klicka och dra för att rita mark - väggar skapas runt om automatiskt'
                  : openingTool
                    ? 'Klicka på en vägg och dra längs den - öppningen sitter kvar på väggen'
                    : tool === 'wall'
                      ? wallChain
                        ? 'Klicka för nästa hörn · klicka på startpunkten för att sluta rummet · dubbelklick, Enter eller Esc avslutar'
                        : 'Klicka för att börja en sammanhängande vägg (klick per hörn) - eller dra för en enskild vägg'
                      : tool === 'counter'
                        ? 'Klicka för att placera kassan'
                        : handMode || spaceDown
                          ? 'Dra för att panorera · Esc lämnar handverktyget'
                          : guides.length > 0
                            ? 'Snappar mot andra bord och väggar · håll Cmd/Ctrl för att dra fritt'
                            : selected.length > 1
                              ? `${selected.length} valda · dra för att flytta alla · Delete tar bort · Cmd/Ctrl+D duplicerar`
                              : 'Dra på tom yta för att markera flera · Scrolla panorerar · Cmd/Ctrl + scroll zoomar · Alt + dra roterar · ? alla kortkommandon'}
            </p>
          </div>

          <aside className="admin-card props-panel">
            <div>
              <p className="props-kicker">VALT ELEMENT</p>
              <p className="props-title">
                {selected.length > 1
                  ? `${selected.length} element valda`
                  : selectedTable
                  ? `Bord ${selectedTable.label.replace('T', '')}`
                  : selectedWall
                    ? 'Vägg'
                    : selectedOpening
                      ? OPENING_LABEL[selectedOpening.kind]
                      : selectedFixture
                        ? 'Kassan'
                        : selectedGround
                          ? 'Markyta'
                          : floor.name}
              </p>
            </div>

            {/* `disabled` på en <fieldset> stänger av ALLA knappar/fält den
                innehåller på en gång - enklare och säkrare än att lägga
                `disabled={readOnly}` på vart och ett av de ~15 reglagen
                nedan. `display:contents` gör att den inte påverkar layouten. */}
            <fieldset
              disabled={readOnly}
              className="props-fieldset"
            >

            {selected.length > 1 && (
              <>
                <p className="props-empty">
                  Dra i något av de valda för att flytta alla. Pilarna flyttar
                  ett rutsteg (Shift: fem), Shift-klicka för att lägga till
                  eller ta bort ur urvalet.
                </p>
                <div className="props-actions">
                  <button
                    type="button"
                    className="btn outline"
                    disabled={selectionClips().length === 0}
                    onClick={() => pasteOnFloor(selectionClips(), 1)}
                  >
                    Duplicera (Cmd/Ctrl+D)
                  </button>
                  {selected.some((x) => x.kind === 'table') && (
                    <button type="button" className="btn outline" onClick={turnSelectedTables}>
                      Vrid borden 90° (Shift+R)
                    </button>
                  )}
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={removeSelected}>
                  Ta bort {selected.length} element
                </button>
              </>
            )}

            {selectedTable && (
              <>
                <div className="props-field">
                  <p className="props-label">FORM</p>
                  <div className="shape-toggle">
                    <button
                      type="button"
                      className={selectedTable.shape === 'round' ? 'active' : ''}
                      onClick={() => {
                        // Runda bord ska alltid vara cirkulära - jämna ut en
                        // ev. rektangulär storlek till en diameter istället
                        // för att bli en oval.
                        const d = (selectedTable.w + selectedTable.h) / 2
                        updateTable({ shape: 'round', w: d, h: d })
                      }}
                    >
                      Rund
                    </button>
                    <button type="button" className={selectedTable.shape === 'square' ? 'active' : ''} onClick={() => updateTable({ shape: 'square' })}>
                      Fyrkantig
                    </button>
                  </div>
                </div>
                <div className="props-field">
                  <p className="props-label">STORLEK</p>
                  <p className="props-pos">{formatSize(selectedTable.w, selectedTable.h)}</p>
                  <p className="props-empty">
                    Dra i handtagen på en sida eller ände av bordet för att
                    ändra bredd eller djup fritt - går att göra avlångt.
                  </p>
                </div>
                <div className="props-field">
                  <p className="props-label">PLATSER</p>
                  <div className="seats-stepper">
                    <button type="button" className="step-btn" disabled={selectedTable.seats <= 1} onClick={() => updateTable({ seats: selectedTable.seats - 1 })}>
                      -
                    </button>
                    <span>{selectedTable.seats}</span>
                    <button type="button" className="step-btn" disabled={selectedTable.seats >= 12} onClick={() => updateTable({ seats: selectedTable.seats + 1 })}>
                      +
                    </button>
                  </div>
                </div>
                <div className="props-field">
                  <p className="props-label">ZON</p>
                  <button
                    type="button"
                    className="zone-chip"
                    title="Klicka för att byta zon"
                    onClick={() => {
                      const i = ZONES.indexOf(selectedTable.zone as (typeof ZONES)[number])
                      updateTable({ zone: ZONES[(i + 1) % ZONES.length] })
                    }}
                  >
                    {selectedTable.zone}
                  </button>
                </div>
                <div className="props-field">
                  <p className="props-label">POSITION</p>
                  <p className="props-pos">{`x: ${Math.round(selectedTable.x)}   y: ${Math.round(selectedTable.y)}`}</p>
                  {selectedTable.shape === 'square' && (
                    <button type="button" className="btn outline" onClick={turnSelectedTables}>
                      <Icon name="rotate" size={16} /> Vrid 90° (Shift+R)
                    </button>
                  )}
                </div>
                <div className="props-field">
                  <p className="props-label">UPPREPA I RAD</p>
                  <div className="seats-stepper">
                    <button type="button" className="step-btn" aria-label="Färre bord" disabled={rowCount <= 1} onClick={() => setRowCount((c) => c - 1)}>
                      -
                    </button>
                    <span>{rowCount}</span>
                    <button type="button" className="step-btn" aria-label="Fler bord" disabled={rowCount >= 12} onClick={() => setRowCount((c) => c + 1)}>
                      +
                    </button>
                  </div>
                  <div className="props-actions">
                    <button type="button" className="btn outline" onClick={() => addRow('right')}>
                      <Icon name="arrow-right" size={16} /> Åt höger
                    </button>
                    <button type="button" className="btn outline" onClick={() => addRow('down')}>
                      <Icon name="arrow-down" size={16} /> Nedåt
                    </button>
                  </div>
                  <p className="props-empty">
                    Lägger till {rowCount} likadana bord efter det här, med
                    lika mellanrum och nästa lediga nummer.
                  </p>
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={() => removeByKind('table', selectedTable.id)}>
                  Ta bort element
                </button>
              </>
            )}

            {selectedWall && (
              <>
                <div className="props-field">
                  <p className="props-label">LÄNGD</p>
                  <div className="seats-stepper">
                    <button type="button" className="step-btn" disabled={selectedWall.length <= GRID} onClick={() => updateWallLength(-GRID)}>
                      -
                    </button>
                    <span>{formatMetres(selectedWall.length)}</span>
                    <button type="button" className="step-btn" onClick={() => updateWallLength(GRID)}>
                      +
                    </button>
                  </div>
                  <p className="props-empty">
                    {selectedWall.dir === 'h' ? 'Vågrät' : 'Lodrät'} - dra i
                    handtagen eller flytta hela väggen. Öppningar på väggen
                    följer med.
                  </p>
                </div>
                <div className="props-field">
                  <p className="props-label">POSITION</p>
                  <p className="props-pos">{`x: ${selectedWall.x}   y: ${selectedWall.y}`}</p>
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={() => removeByKind('wall', selectedWall.id)}>
                  Ta bort vägg (och dess öppningar)
                </button>
              </>
            )}

            {selectedOpening && (
              <>
                <div className="props-field">
                  <p className="props-label">TYP</p>
                  <p className="props-pos">{OPENING_LABEL[selectedOpening.kind]}</p>
                </div>
                <div className="props-field">
                  <p className="props-label">LÄNGD</p>
                  <div className="seats-stepper">
                    <button type="button" className="step-btn" disabled={selectedOpening.length <= GRID} onClick={() => updateOpeningLength(-GRID)}>
                      -
                    </button>
                    <span>{formatMetres(selectedOpening.length)}</span>
                    <button type="button" className="step-btn" onClick={() => updateOpeningLength(GRID)}>
                      +
                    </button>
                  </div>
                  <p className="props-empty">
                    Sitter på väggen - dra för att glida längs den, dra i
                    handtagen för att ändra längd. Kan aldrig lämna väggen.
                  </p>
                </div>
                <div className="props-field">
                  <p className="props-label">PLACERING PÅ VÄGGEN</p>
                  <p className="props-pos">{`${formatMetres(selectedOpening.offset)} från väggens start`}</p>
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={() => removeByKind('opening', selectedOpening.id)}>
                  Ta bort element
                </button>
              </>
            )}

            {selectedFixture && (
              <>
                <div className="props-field">
                  <p className="props-label">TYP</p>
                  <p className="props-pos">Kassadisk</p>
                </div>
                <div className="props-field">
                  <p className="props-label">POSITION</p>
                  <p className="props-pos">{`x: ${Math.round(selectedFixture.x)}   y: ${Math.round(selectedFixture.y)}`}</p>
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={() => removeByKind('fixture', selectedFixture.id)}>
                  Ta bort element
                </button>
              </>
            )}

            {selectedGround && (
              <>
                <div className="props-field">
                  <p className="props-label">STORLEK</p>
                  <p className="props-pos">{formatSize(selectedGround.w, selectedGround.h)}</p>
                </div>
                <div className="props-field">
                  <p className="props-label">POSITION</p>
                  <p className="props-pos">{`x: ${selectedGround.x}   y: ${selectedGround.y}`}</p>
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={() => removeByKind('ground', selectedGround.id)}>
                  Ta bort markyta
                </button>
              </>
            )}

            {selected.length === 0 && (
              <>
                <div className="props-field">
                  <p className="props-label">VÅNINGAR</p>
                  <div className="floor-list">
                    {floors.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={f.id === floor.id ? 'floor-pill active' : 'floor-pill'}
                        onClick={() => switchFloor(f.id)}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" className="btn outline" onClick={addFloor}>
                  + Lägg till våning
                </button>
                <p className="props-empty">
                  Rita mark så skapas väggar runt om automatiskt. Väggar som
                  vetter mot kameran sänks så att borden alltid syns - rotera
                  vyn med Alt + dra eller ⟲ ⟳. Fönster, entré och kök sitter
                  på väggarna och följer med när väggen flyttas eller
                  förlängs. Tryck ? för alla kortkommandon.
                </p>
                {floors.length > 1 && (
                  <>
                    <div className="props-divider" />
                    <button type="button" className="btn danger-outline" onClick={removeCurrentFloor}>
                      Ta bort {floor.name}
                    </button>
                  </>
                )}
              </>
            )}
            </fieldset>
          </aside>
        </div>

        <div className="editor-statusbar">
          <span className="grow" role={layoutError ? 'alert' : undefined}>
            {layoutError ?? statusText}
          </span>
          <span>
            {floor.name}
            {editorName ? ` · Redigeras av ${editorName}` : ''}
          </span>
        </div>
      </div>

      {menu && (
        <div
          className="context-menu"
          role="menu"
          aria-label="Åtgärder"
          style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - 320) }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuItems(menu.target, menu.at).map((group, gi) => (
            <div key={gi} className="context-menu-group" role="group">
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={item.danger ? 'context-menu-item danger' : 'context-menu-item'}
                  disabled={item.disabled}
                  onClick={() => {
                    setMenu(null)
                    item.run()
                  }}
                >
                  <span>{item.label}</span>
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {showVersions && locationId && (
        <LayoutVersionsModal
          locationId={locationId}
          canActivate={canActivate}
          onClose={() => setShowVersions(false)}
          onActivated={refreshVersionLabel}
        />
      )}
    </>
  )
}

/** "2026-10-05T01:00:00Z" -> "5 oktober 2026, 03:00" i lokal tid. */
function formatMoment(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Etiketten i topbaren visar vilken version som GÄLLER, inte bara den senast
 * publicerade - en publicerad version är inaktiv tills någon aktiverat den,
 * och den skillnaden är hela poängen med versionshanteringen.
 *
 * Ligger utanför komponenten för att vara stabil: den anropas både från en
 * effekt och från modalen, utan att bli ett beroende som triggar omkörning.
 */
async function versionLabelFor(locationId: string): Promise<string> {
  try {
    const versions = await listLayoutVersions(locationId)
    if (versions.length === 0) return 'Aldrig publicerad'
    const current = versions.find((v) => v.isCurrent)
    return current
      ? `Gäller: ${current.label}`
      : `${versions[0].label} · ej aktiverad`
  } catch {
    // Utan versionslista är utkastet ändå inläst - visa inget hellre än fel.
    return ''
  }
}

/** Innehållets omslutande rektangel - styr auto-zoom och centrering. */
function contentBounds(floor: Floor): {
  x: number
  y: number
  w: number
  h: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  for (const g of floor.grounds) add(g.x, g.y, g.x + g.w, g.y + g.h)
  for (const w of floor.walls) {
    if (w.dir === 'h') add(w.x, w.y, w.x + w.length, w.y)
    else add(w.x, w.y, w.x, w.y + w.length)
  }
  for (const f of floor.fixtures)
    add(f.x - f.w / 2, f.y - f.h / 2, f.x + f.w / 2, f.y + f.h / 2)
  for (const t of floor.tables) {
    const s = tableSize(t)
    add(t.x - s.w / 2, t.y - s.h / 2, t.x + s.w / 2, t.y + s.h / 2)
  }
  if (!Number.isFinite(minX)) {
    return { x: -400, y: -260, w: 800, h: 520 }
  }
  const w = Math.max(maxX - minX, 400)
  const h = Math.max(maxY - minY, 300)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** En hel vägg. Sänks mjukt till sockel när den skymmer rummet. */
function WallEl({
  wall,
  lowered,
  selected,
  selId,
  showHandles,
  onPointerDown,
  onHandlePointerDown,
}: {
  wall: WallSegment & { draft?: boolean }
  lowered: boolean
  selected: boolean
  /** Satt för väggar på våningen som går att markera med ruta. */
  selId?: string
  showHandles: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onHandlePointerDown: (e: ReactPointerEvent, end: 'a' | 'b') => void
}) {
  const t = WALL_THICKNESS
  const horizontal = wall.dir === 'h'
  const style = {
    left: (horizontal ? wall.x : wall.x - t / 2) + HALF_W,
    top: (horizontal ? wall.y - t / 2 : wall.y) + HALF_H,
    width: horizontal ? Math.max(wall.length, 2) : t,
    height: horizontal ? t : Math.max(wall.length, 2),
    ['--wh' as string]: `${lowered ? WALL_LOW : WALL_HEIGHT}px`,
  }
  const faceA = horizontal ? 'h-n' : 'v-w'
  const faceB = horizontal ? 'h-s' : 'v-e'

  return (
    <div
      className={[
        'seg',
        'wall',
        lowered ? 'lowered' : '',
        selected ? 'selected' : '',
        wall.draft ? 'draft' : '',
      ].join(' ')}
      style={style}
      data-sel-kind={selId ? 'wall' : undefined}
      data-sel-id={selId}
      onPointerDown={onPointerDown}
    >
      <div className={`seg-face full ${faceA}`} />
      <div className={`seg-face full ${faceB}`} />
      <div className="seg-cap" />
      {showHandles && (
        <>
          <div
            className={`seg-handle ${horizontal ? 'h-a' : 'v-a'}`}
            title="Dra för att ändra längd"
            onPointerDown={(e) => onHandlePointerDown(e, 'a')}
          />
          <div
            className={`seg-handle ${horizontal ? 'h-b' : 'v-b'}`}
            title="Dra för att ändra längd"
            onPointerDown={(e) => onHandlePointerDown(e, 'b')}
          />
        </>
      )}
    </div>
  )
}

/** En öppning som sitter PÅ en vägg: fönster, entré eller kökets ingång. */
function OpeningEl({
  opening,
  wall,
  lowered,
  selected,
  showHandles,
  onPointerDown,
  onHandlePointerDown,
}: {
  opening: Opening & { draft?: boolean }
  wall: WallSegment
  lowered: boolean
  selected: boolean
  showHandles: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onHandlePointerDown: (e: ReactPointerEvent, end: 'a' | 'b') => void
}) {
  const t = OPENING_THICKNESS
  const horizontal = wall.dir === 'h'
  const x = horizontal ? wall.x + opening.offset : wall.x
  const y = horizontal ? wall.y : wall.y + opening.offset
  const style = {
    left: (horizontal ? x : x - t / 2) + HALF_W,
    top: (horizontal ? y - t / 2 : y) + HALF_H,
    width: horizontal ? Math.max(opening.length, 2) : t,
    height: horizontal ? t : Math.max(opening.length, 2),
    ['--wh' as string]: `${lowered ? WALL_LOW : WALL_HEIGHT}px`,
  }
  const faceA = horizontal ? 'h-n' : 'v-w'
  const faceB = horizontal ? 'h-s' : 'v-e'

  return (
    <div
      className={[
        'seg',
        opening.kind,
        lowered ? 'lowered' : '',
        selected ? 'selected' : '',
        opening.draft ? 'draft' : '',
      ].join(' ')}
      style={style}
      data-sel-kind={opening.draft ? undefined : 'opening'}
      data-sel-id={opening.draft ? undefined : opening.id}
      onPointerDown={onPointerDown}
    >
      {opening.kind === 'window' && (
        <>
          {/* glasband som sitter i väggen - väggen bakom är kvar */}
          <div className={`seg-face glass ${faceA}`} />
          <div className={`seg-face glass ${faceB}`} />
          <div className="seg-cap glass-cap" />
        </>
      )}

      {/* Entré och kök ritas likadant - bara skylten skiljer dem åt. */}
      {(opening.kind === 'kitchen' || opening.kind === 'entrance') && (
        <>
          <div className={`seg-face full ${faceA}`} />
          <div className={`seg-face full ${faceB}`} />
          <div className="seg-cap" />
          <div className="seg-tag">
            <span>{opening.kind === 'kitchen' ? 'KÖK' : 'ENTRÉ'}</span>
          </div>
        </>
      )}

      {showHandles && (
        <>
          <div
            className={`seg-handle ${horizontal ? 'h-a' : 'v-a'}`}
            title="Dra för att ändra längd"
            onPointerDown={(e) => onHandlePointerDown(e, 'a')}
          />
          <div
            className={`seg-handle ${horizontal ? 'h-b' : 'v-b'}`}
            title="Dra för att ändra längd"
            onPointerDown={(e) => onHandlePointerDown(e, 'b')}
          />
        </>
      )}
    </div>
  )
}

function ToolButton({
  icon,
  caption,
  title,
  shortcut,
  active,
  disabled,
  onClick,
  onPointerDown,
}: {
  icon: IconName
  caption: string
  title: string
  /** Bokstaven som väljer verktyget - visas i hörnet och i tooltipen. */
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  onPointerDown?: (e: ReactPointerEvent) => void
}) {
  const full = shortcut ? `${title} (${shortcut})` : title
  return (
    <button
      type="button"
      className={active ? 'tool-btn active' : 'tool-btn'}
      title={full}
      aria-label={full}
      aria-keyshortcuts={shortcut}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
      <Icon name={icon} size={20} />
      <small>{caption}</small>
      {shortcut && <kbd className="tool-key" aria-hidden="true">{shortcut}</kbd>}
    </button>
  )
}

const SHORTCUTS: { group: string; rows: [string, string][] }[] = [
  {
    group: 'Verktyg',
    rows: [
      ['V', 'Välj och flytta'],
      ['H / håll mellanslag', 'Hand - panorera'],
      ['M', 'Mark (väggar skapas runt om)'],
      ['W', 'Vägg - klick per hörn, dubbelklick/Enter avslutar'],
      ['F · E · K', 'Fönster · Entré · Kökets ingång'],
      ['C', 'Kassa'],
      ['T · R', 'Fyrkantigt · runt bord (eller dra ut från verktygsfältet)'],
    ],
  },
  {
    group: 'Redigera',
    rows: [
      ['Cmd/Ctrl + Z', 'Ångra'],
      ['Cmd/Ctrl + Shift + Z', 'Gör om'],
      ['Shift + klick', 'Lägg till / ta bort ur urvalet'],
      ['Dra på tom yta', 'Markera med en ruta'],
      ['Cmd/Ctrl + A', 'Markera allt på våningen'],
      ['Delete / Backspace', 'Ta bort det valda'],
      ['Shift + R', 'Vrid valda bord 90°'],
      ['Cmd/Ctrl medan du drar', 'Flytta utan att snappa mot andra'],
      ['Högerklick', 'Meny: duplicera, klistra in här, vrid, ta bort, nytt bord här'],
      ['Cmd/Ctrl + D', 'Duplicera'],
      ['Cmd/Ctrl + C · V', 'Kopiera · klistra in (även till en annan våning)'],
      ['Pilar (Shift)', 'Flytta 1 ruta (5 rutor)'],
      ['Esc', 'Avbryt, byt till Välj, avmarkera'],
    ],
  },
  {
    group: 'Vy',
    rows: [
      ['Scroll · dra med mittenknappen', 'Panorera'],
      ['Cmd/Ctrl + scroll · nyp', 'Zooma mot pekaren'],
      ['Alt + dra', 'Rotera vyn'],
      ['Shift + 1', 'Zooma till allt'],
      ['Shift + 0', '100 %'],
      ['?', 'Visa/dölj den här listan'],
    ],
  },
]

/** Kortkommandolistan, som Figmas "?" - stängs med Esc, ? eller krysset. */
function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="shortcut-sheet"
      role="dialog"
      aria-label="Kortkommandon"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="shortcut-head">
        <p className="props-kicker">KORTKOMMANDON</p>
        <button type="button" className="shortcut-close" aria-label="Stäng" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="shortcut-groups">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3>{g.group}</h3>
            <dl>
              {g.rows.map(([keys, what]) => (
                <div key={keys} className="shortcut-row">
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}
