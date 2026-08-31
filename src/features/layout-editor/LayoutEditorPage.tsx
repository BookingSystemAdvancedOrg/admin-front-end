import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import {
  GRID,
  OPENING_LABEL,
  SEAT_SIZE,
  WORKSPACE,
  ZONES,
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
  listLayoutElements,
  loadLayoutExtras,
  saveFloor,
  saveLayoutExtras,
  toDoorKinds,
  toFloorElements,
} from './layoutApi'
import './layout-editor.css'

const TILT_DEG = 55
const PERSPECTIVE = 1600
const TABLE_HEIGHT = 22
const WALL_HEIGHT = 90
/** Sockelhöjd för väggar som vetter mot kameran — borden ska alltid synas. */
const WALL_LOW = 16
const WALL_THICKNESS = 10
const OPENING_THICKNESS = 14
const COUNTER_HEIGHT = 34
/**
 * Hur långt från en vägg man får klicka och ändå träffa den. Måttet gäller
 * i golvplanet, och i 3D-vyn blir den zonen visuellt smal — därför generöst
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

type Selection =
  | { kind: 'table'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'fixture'; id: string }
  | { kind: 'ground'; id: string }
  | null

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

/** Samma nyckel som Inställningar sparar platsen under. */
const LOCATION_ID_STORAGE_KEY = 'admin-location-id'

const OPENING_TOOLS: { tool: Tool; kind: OpeningKind; warn: string }[] = [
  { tool: 'window', kind: 'window', warn: 'Fönster kan bara placeras på en vägg — rita väggen först.' },
  { tool: 'entrance', kind: 'entrance', warn: 'Entrén kan bara placeras på en vägg — rita väggen först.' },
  { tool: 'kitchen', kind: 'kitchen', warn: 'Kökets ingång kan bara placeras på en vägg — rita väggen först.' },
]

/**
 * Figma: admin-live-layout-editor-page (26:2), byggd som riktig 3D-scen i
 * CSS. Origo ligger i canvasens mitt. Marken ritas fritt och får
 * automatiskt väggar runt om. Väggar som vetter mot kameran sänks till en
 * låg sockel så att borden alltid syns (och reser sig igen när vyn
 * roteras). Öppningar — fönster, entré, kökets ingång — sitter PÅ
 * väggarna: väggen förblir hel, öppningen glider längs den när den
 * flyttas eller förlängs, och följer med om väggen flyttas.
 *
 * Väggar, öppningar och bord synkas mot det riktiga layout-API:t
 * (layoutApi.ts): de läses in vid sidladdning och skrivs vid "Publicera
 * layout". Markytor, kassan och extra våningar finns inte i API:ts
 * datamodell och lever bara lokalt — se kommentaren i layoutApi.ts.
 */
export default function LayoutEditorPage() {
  // Editorn startar tom och fylls av serverns layout. Ingen mockdata visas
  // först — den hann annars blinka förbi innan inläsningen var klar.
  const [floors, setFloors] = useState<Floor[]>(() => [emptyFloor(1)])
  const [currentFloorId, setCurrentFloorId] = useState(() => floors[0].id)
  const [selection, setSelection] = useState<Selection>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [is3d, setIs3d] = useState(true)
  const [spin, setSpin] = useState(45)
  const [manualZoom, setManualZoom] = useState(1)
  const [sceneSize, setSceneSize] = useState({ w: 1000, h: 600 })
  const [wallDraft, setWallDraft] = useState<WallDraft | null>(null)
  const [openingDraft, setOpeningDraft] = useState<OpeningDraft | null>(null)
  const [groundDraft, setGroundDraft] = useState<GroundDraft | null>(null)
  const [drawWarning, setDrawWarning] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('Hämtar layout…')
  const [versionLabel, setVersionLabel] = useState('')
  // Utan en sparad plats finns inget layout-API att prata med — då kör
  // editorn vidare på mockdatan som förut.
  const [locationId] = useState<string | null>(() =>
    localStorage.getItem(LOCATION_ID_STORAGE_KEY),
  )
  const [publishing, setPublishing] = useState(false)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextTable = useRef(14)
  const nextId = useRef(1)
  const drag = useRef<DragState | null>(null)

  const floor = floors.find((f) => f.id === currentFloorId) ?? floors[0]

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const ro = new ResizeObserver(() => {
      setSceneSize({ w: scene.clientWidth, h: scene.clientHeight })
    })
    ro.observe(scene)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setManualZoom((z) => clamp(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.35, 2.5))
    }
    scene.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      scene.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Läs in den sparade layouten. Markytor och kassan finns inte i API:t, så
  // en inläst våning börjar utan dem — bara väggar, öppningar och bord.
  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    listLayoutElements(locationId)
      .then((elements) => {
        if (cancelled) return
        // Markytor, kassan och dörrtyperna kommer från webbläsaren — API:t
        // kan inte lagra dem.
        const extras = loadLayoutExtras(locationId)
        const loaded = toFloorElements(elements, extras.doorKinds)
        setFloors([
          {
            id: 'floor-1',
            name: 'Våning 1',
            grounds: extras.grounds,
            fixtures: extras.fixtures,
            ...loaded,
          },
        ])
        setCurrentFloorId('floor-1')
        setSelection(null)
        setVersionLabel(
          elements.length === 0
            ? 'Ingen sparad layout än'
            : `${elements.length} sparade element`,
        )
        setStatusText(
          elements.length === 0
            ? 'Tom layout — rita och publicera för att spara.'
            : 'Inläst från servern.',
        )
      })
      .catch((err) => {
        if (!cancelled) {
          setLayoutError(
            err instanceof Error ? err.message : 'Kunde inte hämta layouten.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [locationId])

  function patchFloor(patch: (f: Floor) => Partial<Floor>) {
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
  }

  function warn(message: string) {
    setDrawWarning(message)
    if (warnTimer.current) clearTimeout(warnTimer.current)
    warnTimer.current = setTimeout(() => setDrawWarning(null), 3000)
  }

  /* --- Auto-zoom -------------------------------------------------------- */

  const bounds = contentBounds(floor)
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
   * vilket håll som är "inomhus" när det inte finns någon ritad markyta —
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
   * En vägg sänks till sockel när den står mellan kameran och rummet —
   * så att borden alltid syns. Vald vägg (eller vägg med vald öppning)
   * hålls alltid uppe så att den går att redigera.
   */
  function isLowered(w: WallSegment): boolean {
    if (!is3d) return false
    if (selection?.kind === 'wall' && selection.id === w.id) return false
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
      // Väggen går genom mitten — den skymmer inget, låt den stå.
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
    const mx = clientX - (rect.left + rect.width / 2)
    const my = clientY - (rect.top + rect.height / 2)
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
      // rutnätsruta utanför ändarna — annars fångas grannväggen i hörnen.
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

  function onScenePointerDown(e: ReactPointerEvent) {
    const p = unproject(e.clientX, e.clientY)
    const px = clamp(snap(p.x), -HALF_W, HALF_W)
    const py = clamp(snap(p.y), -HALF_H, HALF_H)
    if (tool === 'ground') {
      setGroundDraft({ x0: px, y0: py, x: px, y: py, w: 0, h: 0 })
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (tool === 'wall') {
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
      return
    }
    if (tool === 'select') setSelection(null)
  }

  function onScenePointerMove(e: ReactPointerEvent) {
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
      const dx = clamp(snap(p.x), -HALF_W, HALF_W) - wallDraft.x0
      const dy = clamp(snap(p.y), -HALF_H, HALF_H) - wallDraft.y0
      if (Math.abs(dx) >= Math.abs(dy)) {
        const len = Math.abs(dx)
        setWallDraft({
          ...wallDraft,
          dir: 'h',
          x: dx < 0 ? wallDraft.x0 - len : wallDraft.x0,
          y: wallDraft.y0,
          length: len,
        })
      } else {
        const len = Math.abs(dy)
        setWallDraft({
          ...wallDraft,
          dir: 'v',
          x: wallDraft.x0,
          y: dy < 0 ? wallDraft.y0 - len : wallDraft.y0,
          length: len,
        })
      }
      return
    }
    const d = drag.current
    if (!d) return

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
            // Öppningen glider längs väggen — aldrig utanför.
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

    const dx = (e.clientX - d.startX) / zoom
    const dy = (e.clientY - d.startY) / zoom
    const S = -spinRad
    const unTiltY = is3d ? dy / Math.cos((TILT_DEG * Math.PI) / 180) : dy
    const fx = dx * Math.cos(S) - unTiltY * Math.sin(S)
    const fy = dx * Math.sin(S) + unTiltY * Math.cos(S)
    if (d.kind === 'table') {
      patchFloor((fl) => ({
        tables: fl.tables.map((t) => {
          if (t.id !== d.id) return t
          const size = tableSize(t)
          return {
            ...t,
            x: clamp(d.origX + fx, -HALF_W + size.w / 2, HALF_W - size.w / 2),
            y: clamp(d.origY + fy, -HALF_H + size.h / 2, HALF_H - size.h / 2),
          }
        }),
      }))
    } else {
      patchFloor((fl) => ({
        fixtures: fl.fixtures.map((f) => {
          if (f.id !== d.id) return f
          return {
            ...f,
            x: clamp(d.origX + fx, -HALF_W + f.w / 2, HALF_W - f.w / 2),
            y: clamp(d.origY + fy, -HALF_H + f.h / 2, HALF_H - f.h / 2),
          }
        }),
      }))
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
        // Marken får automatiskt väggar runt om — de ingår.
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
      if (wallDraft.length >= GRID) {
        const w: WallSegment = {
          id: `w${nextId.current++}`,
          dir: wallDraft.dir,
          x: wallDraft.x,
          y: wallDraft.y,
          length: wallDraft.length,
        }
        patchFloor((fl) => ({ walls: [...fl.walls, w] }))
        setSelection({ kind: 'wall', id: w.id })
        markDirty()
      }
      setWallDraft(null)
      return
    }
    if (drag.current) {
      drag.current = null
      markDirty()
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
    if (isDrawTool) return
    e.stopPropagation()
    if (tool === 'erase') {
      removeByKind(kind, id)
      return
    }
    setSelection({ kind, id } as Selection)
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
    e.stopPropagation()
    drag.current =
      kind === 'wall' ? { kind: 'wall-end', id, end } : { kind: 'op-end', id, end }
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

  function addTable(shape: TableShape) {
    const n = nextTable.current++
    const t: TableElement = {
      id: `t${n}-${shape}`,
      label: `T${n}`,
      shape,
      seats: shape === 'round' ? 2 : 4,
      zone: 'Mitten',
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2,
      rotation: 0,
    }
    patchFloor((fl) => ({ tables: [...fl.tables, t] }))
    setSelection({ kind: 'table', id: t.id })
    setTool('select')
    markDirty()
  }

  function addFloor() {
    const f = emptyFloor(floors.length + 1)
    setFloors((prev) => [...prev, f])
    setCurrentFloorId(f.id)
    setSelection(null)
    setTool('ground')
    markDirty()
  }

  function switchFloor(id: string) {
    setCurrentFloorId(id)
    setSelection(null)
    setWallDraft(null)
    setOpeningDraft(null)
    setGroundDraft(null)
  }

  function removeCurrentFloor() {
    if (floors.length <= 1) return
    const rest = floors.filter((f) => f.id !== floor.id)
    setFloors(rest.map((f, i) => ({ ...f, name: `Våning ${i + 1}` })))
    setCurrentFloorId(rest[0].id)
    setSelection(null)
    markDirty()
  }

  async function publish() {
    if (!locationId) {
      setLayoutError(
        'Ingen plats är sparad än — skapa restaurangens plats under ' +
          'Inställningar innan layouten kan publiceras.',
      )
      return
    }
    setLayoutError(null)
    setPublishing(true)
    try {
      // API:t har en enda elementlista per plats, inte en per våning, så
      // bara den första våningen kan sparas.
      const result = await saveFloor(locationId, floors[0])
      // Markytor, kassan och skillnaden entré/kök kan API:t inte lagra — de
      // sparas lokalt så att de åtminstone finns kvar efter en omladdning.
      // Dörrtyperna nycklas om till serverns id:n för det som just skapats.
      const doorKinds = toDoorKinds(floors[0].openings, result.idMap)
      saveLayoutExtras(locationId, {
        grounds: floors[0].grounds,
        fixtures: floors[0].fixtures,
        doorKinds,
      })
      const loaded = toFloorElements(result.elements, doorKinds)
      // Läs in serverns svar igen: nyskapade element får sina riktiga
      // elementId, vilket nästa publicering behöver för att se dem som
      // befintliga istället för att skapa dubbletter.
      setFloors((prev) => [{ ...prev[0], ...loaded }, ...prev.slice(1)])
      setSelection(null)
      setVersionLabel(`${result.elements.length} sparade element`)
      setStatusText(
        `Publicerad — ${result.created} nya, ${result.updated} ändrade, ` +
          `${result.deleted} borttagna.` +
          (floors.length > 1
            ? ` Endast ${floors[0].name} sparas — API:t har ingen våningsmodell.`
            : ''),
      )
    } catch (err) {
      setLayoutError(
        err instanceof Error ? err.message : 'Kunde inte publicera layouten.',
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
        title="Live Layout Editor"
        actions={
          <span className="row-actions">
            <span className="cell-muted">{versionLabel}</span>
            <button type="button" className="btn outline">
              Förhandsgranska
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={publishing}
              onClick={publish}
            >
              {publishing ? 'Publicerar…' : 'Publicera layout'}
            </button>
          </span>
        }
      />
      <div className="admin-main">
        {!locationId && (
          <p className="form-error" role="alert">
            Layouten sparas inte: ingen restaurangplats är skapad än. Gå till
            Inställningar och spara restaurangprofilen först — layouten lagras
            per plats i API:t. Det du ritar här försvinner vid omladdning tills
            dess.
          </p>
        )}
        {layoutError && (
          <p className="form-error" role="alert">
            {layoutError}
          </p>
        )}
        <div className="editor-row">
          <div className="admin-card editor-toolbar">
            <ToolButton glyph="↖" caption="Välj" title="Välj, flytta och ändra storlek" active={tool === 'select'} onClick={() => setTool('select')} />
            <ToolButton glyph="▦" caption="Mark" title="Rita mark — väggar skapas runt om automatiskt" active={tool === 'ground'} onClick={() => setTool('ground')} />
            <ToolButton glyph="▬" caption="Vägg" title="Rita vägg — klicka och dra" active={tool === 'wall'} onClick={() => setTool('wall')} />
            <ToolButton glyph="▭" caption="Fönster" title="Fönster — placeras på en vägg" active={tool === 'window'} onClick={() => setTool('window')} />
            <ToolButton glyph="◐" caption="Entré" title="Entré — placeras på en vägg" active={tool === 'entrance'} onClick={() => setTool('entrance')} />
            <ToolButton glyph="◑" caption="Kök" title="Kökets ingång — placeras på en vägg" active={tool === 'kitchen'} onClick={() => setTool('kitchen')} />
            <ToolButton glyph="▣" caption="Kassa" title="Placera kassan — klicka" active={tool === 'counter'} onClick={() => setTool('counter')} />
            <ToolButton glyph="■" caption="Bord" title="Lägg till fyrkantigt bord" active={tool === 'add-square'} onClick={() => addTable('square')} />
            <ToolButton glyph="●" caption="Bord" title="Lägg till runt bord" active={tool === 'add-round'} onClick={() => addTable('round')} />
            <ToolButton glyph="✕" caption="Radera" title="Radera — klicka på ett element" active={tool === 'erase'} onClick={() => setTool((t) => (t === 'erase' ? 'select' : 'erase'))} />
          </div>

          <div
            ref={sceneRef}
            className={isDrawTool ? 'floor-scene tool-draw' : 'floor-scene'}
            onPointerDown={onScenePointerDown}
            onPointerMove={onScenePointerMove}
            onPointerUp={onScenePointerUp}
            onPointerLeave={onScenePointerUp}
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
              <div className="view-toggle">
                <button type="button" title="Zooma ut" onClick={() => setManualZoom((z) => clamp(z / 1.2, 0.35, 2.5))}>
                  −
                </button>
                <button type="button" className="zoom-value" title="Återställ zoom" onClick={() => setManualZoom(1)}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" title="Zooma in" onClick={() => setManualZoom((z) => clamp(z * 1.2, 0.35, 2.5))}>
                  +
                </button>
              </div>
              <div className="view-toggle">
                <button type="button" title="Rotera vyn moturs" onClick={() => setSpin((s) => s - 45)}>
                  ⟲
                </button>
                <button type="button" title="Rotera vyn medurs" onClick={() => setSpin((s) => s + 45)}>
                  ⟳
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
            </div>

            <div
              className="floor-world"
              style={{
                ['--tilt' as string]: is3d ? `${TILT_DEG}deg` : '0deg',
                ['--spin' as string]: `${spin}deg`,
                ['--zoom' as string]: zoom,
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
                {drawnGrounds.map((g) => (
                  <div
                    key={g.id}
                    className={[
                      'ground',
                      selection?.kind === 'ground' && selection.id === g.id ? 'selected' : '',
                      g.draft ? 'draft' : '',
                    ].join(' ')}
                    style={{ left: g.x + HALF_W, top: g.y + HALF_H, width: g.w, height: g.h }}
                    onPointerDown={(e) => onElementPointerDown(e, 'ground', g.id)}
                  />
                ))}

                {drawnWalls.map((w) => (
                  <WallEl
                    key={w.id}
                    wall={w}
                    lowered={loweredById.get(w.id) ?? false}
                    selected={selection?.kind === 'wall' && selection.id === w.id}
                    showHandles={
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
                      selected={
                        selection?.kind === 'opening' && selection.id === o.id
                      }
                      showHandles={
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
                    className={
                      selection?.kind === 'fixture' && selection.id === f.id
                        ? 'fixture selected'
                        : 'fixture'
                    }
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
                        selection?.kind === 'table' && selection.id === t.id ? 'selected' : '',
                      ].join(' ')}
                      style={{
                        left: t.x - size.w / 2 + HALF_W,
                        top: t.y - size.h / 2 + HALF_H,
                        width: size.w,
                        height: size.h,
                        ['--th' as string]: `${TABLE_HEIGHT}px`,
                      }}
                      onPointerDown={(e) => onElementPointerDown(e, 'table', t.id, t.x, t.y)}
                    >
                      {/* En stol per plats — antalet syns direkt i planen. */}
                      {seatPositions(t).map((s, i) => (
                        <div
                          key={i}
                          className="table-seat"
                          style={{
                            left: size.w / 2 + s.x - SEAT_SIZE / 2,
                            top: size.h / 2 + s.y - SEAT_SIZE / 2,
                            width: SEAT_SIZE,
                            height: SEAT_SIZE,
                          }}
                        />
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
                    </div>
                  )
                })}
              </div>
            </div>

            {floorIsEmpty && (
              <div className="scene-empty">
                <p>
                  <strong>{floor.name} är tom.</strong>
                  <br />
                  Börja i mitten — origo (0,0) — med <b>Mark</b>-verktyget och
                  rita golvet. Väggar skapas runt marken automatiskt.
                </p>
              </div>
            )}

            <p className={drawWarning ? 'scene-hint warning' : 'scene-hint'}>
              {drawWarning
                ? drawWarning
                : tool === 'ground'
                  ? 'Klicka och dra för att rita mark — väggar skapas runt om automatiskt'
                  : openingTool
                    ? 'Klicka på en vägg och dra längs den — öppningen sitter kvar på väggen'
                    : tool === 'wall'
                      ? 'Klicka och dra för att bygga — snappar till rutnätet'
                      : tool === 'counter'
                        ? 'Klicka för att placera kassan'
                        : 'Väggar mot kameran sänks så borden syns · rotera med ⟲ ⟳'}
            </p>
          </div>

          <aside className="admin-card props-panel">
            <div>
              <p className="props-kicker">VALT ELEMENT</p>
              <p className="props-title">
                {selectedTable
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

            {selectedTable && (
              <>
                <div className="props-field">
                  <p className="props-label">FORM</p>
                  <div className="shape-toggle">
                    <button type="button" className={selectedTable.shape === 'round' ? 'active' : ''} onClick={() => updateTable({ shape: 'round' })}>
                      Rund
                    </button>
                    <button type="button" className={selectedTable.shape === 'square' ? 'active' : ''} onClick={() => updateTable({ shape: 'square' })}>
                      Fyrkantig
                    </button>
                  </div>
                </div>
                <div className="props-field">
                  <p className="props-label">PLATSER</p>
                  <div className="seats-stepper">
                    <button type="button" className="step-btn" disabled={selectedTable.seats <= 1} onClick={() => updateTable({ seats: selectedTable.seats - 1 })}>
                      –
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
                  <p className="props-label">POSITION &amp; ROTATION</p>
                  <p className="props-pos">{`x: ${Math.round(selectedTable.x)}   y: ${Math.round(selectedTable.y)}   rotation: ${selectedTable.rotation}°`}</p>
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
                      –
                    </button>
                    <span>{selectedWall.length}</span>
                    <button type="button" className="step-btn" onClick={() => updateWallLength(GRID)}>
                      +
                    </button>
                  </div>
                  <p className="props-empty">
                    {selectedWall.dir === 'h' ? 'Vågrät' : 'Lodrät'} — dra i
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
                      –
                    </button>
                    <span>{selectedOpening.length}</span>
                    <button type="button" className="step-btn" onClick={() => updateOpeningLength(GRID)}>
                      +
                    </button>
                  </div>
                  <p className="props-empty">
                    Sitter på väggen — dra för att glida längs den, dra i
                    handtagen för att ändra längd. Kan aldrig lämna väggen.
                  </p>
                </div>
                <div className="props-field">
                  <p className="props-label">PLACERING PÅ VÄGGEN</p>
                  <p className="props-pos">{`${selectedOpening.offset} enheter från väggens start`}</p>
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
                  <p className="props-pos">{`${selectedGround.w} × ${selectedGround.h} enheter`}</p>
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

            {!selectedTable && !selectedWall && !selectedOpening && !selectedFixture && !selectedGround && (
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
                  vetter mot kameran sänks så att borden alltid syns — rotera
                  vyn med ⟲ ⟳. Fönster, entré och kök sitter på väggarna och
                  följer med när väggen flyttas eller förlängs.
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
          </aside>
        </div>

        <div className="editor-statusbar">
          <span className="grow" role={layoutError ? 'alert' : undefined}>
            {layoutError ?? statusText}
          </span>
          <span>{floor.name} · Redigeras av Anna (personal)</span>
        </div>
      </div>
    </>
  )
}

/** Innehållets omslutande rektangel — styr auto-zoom och centrering. */
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
  showHandles,
  onPointerDown,
  onHandlePointerDown,
}: {
  wall: WallSegment & { draft?: boolean }
  lowered: boolean
  selected: boolean
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
      onPointerDown={onPointerDown}
    >
      {opening.kind === 'window' && (
        <>
          {/* glasband som sitter i väggen — väggen bakom är kvar */}
          <div className={`seg-face glass ${faceA}`} />
          <div className={`seg-face glass ${faceB}`} />
          <div className="seg-cap glass-cap" />
        </>
      )}

      {/* Entré och kök ritas likadant — bara skylten skiljer dem åt. */}
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
  glyph,
  caption,
  title,
  active,
  disabled,
  onClick,
}: {
  glyph: string
  caption: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={active ? 'tool-btn active' : 'tool-btn'}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {glyph}
      <small>{caption}</small>
    </button>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}
