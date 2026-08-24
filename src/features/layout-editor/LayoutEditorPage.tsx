import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AdminTopbar } from '../../shared/AdminTopbar'
import {
  GRID,
  MOCK_LAYOUT,
  SEGMENT_LABEL,
  WORKSPACE,
  ZONES,
  emptyFloor,
  tableSize,
} from './data'
import type {
  Fixture,
  Floor,
  GroundRect,
  SegmentKind,
  TableElement,
  TableShape,
  WallSegment,
} from './data'
import './layout-editor.css'

const TILT_DEG = 55
const PERSPECTIVE = 1600
const TABLE_HEIGHT = 22
const WALL_HEIGHT = 90
const WALL_THICKNESS = 10
const COUNTER_HEIGHT = 34
/** Hur nära en vägg man måste klicka för att fönster/entré/kök ska fästa. */
const WALL_SNAP_DIST = 28
/** Origo ligger i canvasens mitt — koordinaterna går från -HALF till +HALF. */
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
  | { kind: 'segment'; id: string }
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
  | { kind: 'seg-move'; id: string; offX: number; offY: number }
  | { kind: 'seg-end'; id: string; end: 'a' | 'b' }

interface SegDraft {
  kind: SegmentKind
  x0: number
  y0: number
  dir: 'h' | 'v'
  x: number
  y: number
  length: number
  /** Vägg som öppningen fästs på (fönster/entré/kök). */
  hostWallId?: string
}

interface GroundDraft {
  x0: number
  y0: number
  x: number
  y: number
  w: number
  h: number
}

/** Verktyg som ritar öppningar och därför kräver en vägg att fästa på. */
const OPENING_TOOLS: { tool: Tool; kind: SegmentKind; warn: string }[] = [
  { tool: 'window', kind: 'window', warn: 'Fönster kan bara placeras på en vägg — rita väggen först.' },
  { tool: 'entrance', kind: 'entrance', warn: 'Entrén kan bara placeras på en vägg — rita väggen först.' },
  { tool: 'kitchen', kind: 'kitchen', warn: 'Kökets ingång kan bara placeras på en vägg — rita väggen först.' },
]

/**
 * Figma: admin-live-layout-editor-page (26:2), byggd som riktig 3D-scen i
 * CSS. Origo ligger i canvasens mitt och allt byggande utgår därifrån.
 * Marken ritas fritt, väggar ovanpå; öppningar (fönster, entré, kökets
 * ingång) kan bara placeras på väggar och delar dem automatiskt. Valda
 * väggar kan flyttas och storleksändras med handtagen i ändarna.
 * Kör på mockdata i lokal state tills API:t kopplas.
 */
export default function LayoutEditorPage() {
  const [floors, setFloors] = useState<Floor[]>(MOCK_LAYOUT.floors)
  const [currentFloorId, setCurrentFloorId] = useState(MOCK_LAYOUT.floors[0].id)
  const [selection, setSelection] = useState<Selection>({
    kind: 'table',
    id: 't3',
  })
  const [tool, setTool] = useState<Tool>('select')
  const [is3d, setIs3d] = useState(true)
  const [spin, setSpin] = useState(45)
  const [manualZoom, setManualZoom] = useState(1)
  const [sceneSize, setSceneSize] = useState({ w: 1000, h: 600 })
  const [segDraft, setSegDraft] = useState<SegDraft | null>(null)
  const [groundDraft, setGroundDraft] = useState<GroundDraft | null>(null)
  const [drawWarning, setDrawWarning] = useState<string | null>(null)
  const [statusText, setStatusText] = useState(
    'Senast sparat: för 2 minuter sedan (utkast, ej publicerat)',
  )
  const [versionLabel, setVersionLabel] = useState(
    `Version ${MOCK_LAYOUT.version} · ${MOCK_LAYOUT.publishedLabel}`,
  )
  const sceneRef = useRef<HTMLDivElement>(null)
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextTable = useRef(14)
  const nextId = useRef(1)
  const drag = useRef<DragState | null>(null)

  const floor = floors.find((f) => f.id === currentFloorId) ?? floors[0]

  // Mät canvasen (för auto-zoom) och zooma med scrollhjulet.
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

  function patchFloor(patch: (f: Floor) => Partial<Floor>) {
    setFloors((prev) =>
      prev.map((f) => (f.id === floor.id ? { ...f, ...patch(f) } : f)),
    )
  }

  const selectedTable =
    selection?.kind === 'table'
      ? floor.tables.find((t) => t.id === selection.id) ?? null
      : null
  const selectedSegment =
    selection?.kind === 'segment'
      ? floor.segments.find((s) => s.id === selection.id) ?? null
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

  /* --- Auto-zoom: allt ritat ska alltid få plats i canvasen ------------- */

  const bounds = contentBounds(floor)
  const pad = 90
  const bw = bounds.w + pad * 2
  const bh = bounds.h + pad * 2
  let fit: number
  if (is3d) {
    const T = (TILT_DEG * Math.PI) / 180
    const diag = (bw + bh) * 0.707
    fit = Math.min(
      sceneSize.w / diag,
      sceneSize.h / (diag * Math.cos(T) + 150),
    )
  } else {
    const straight = spin % 180 === 0
    const quarter = spin % 90 === 0 && !straight
    const pw = straight ? bw : quarter ? bh : Math.hypot(bw, bh)
    const ph = straight ? bh : quarter ? bw : Math.hypot(bw, bh)
    fit = Math.min(sceneSize.w / pw, sceneSize.h / ph)
  }
  const zoom = clamp(fit, 0.2, 1.15) * manualZoom
  // Vyn centreras på innehållet genom att planet förskjuts.
  const tx = -(bounds.x + bounds.w / 2)
  const ty = -(bounds.y + bounds.h / 2)

  /**
   * Översätter en musposition till origo-koordinater (0,0 = canvasens
   * mitt) — inverterar rotation, lutning, zoom, perspektiv och
   * innehålls-förskjutningen.
   */
  function unproject(clientX: number, clientY: number): { x: number; y: number } {
    const scene = sceneRef.current
    if (!scene) return { x: 0, y: 0 }
    const rect = scene.getBoundingClientRect()
    const mx = clientX - (rect.left + rect.width / 2)
    const my = clientY - (rect.top + rect.height / 2)
    const T = is3d ? (TILT_DEG * Math.PI) / 180 : 0
    const S = (spin * Math.PI) / 180
    const d = PERSPECTIVE
    const k = zoom
    const yr = (my * d) / (k * (d * Math.cos(T) + my * Math.sin(T)))
    const f = d / (d - k * yr * Math.sin(T))
    const xr = mx / (k * f)
    const x = xr * Math.cos(S) + yr * Math.sin(S)
    const y = -xr * Math.sin(S) + yr * Math.cos(S)
    return { x: x - tx, y: y - ty }
  }

  function snap(v: number): number {
    return Math.round(v / GRID) * GRID
  }

  /** Närmaste vägg (inte öppning) inom snäpp-avstånd från en punkt. */
  function nearestWall(p: { x: number; y: number }): WallSegment | null {
    let best: WallSegment | null = null
    let bestDist = WALL_SNAP_DIST
    for (const s of floor.segments) {
      if (s.kind !== 'wall') continue
      const dist =
        s.dir === 'h'
          ? p.x >= s.x - WALL_SNAP_DIST && p.x <= s.x + s.length + WALL_SNAP_DIST
            ? Math.abs(p.y - s.y)
            : Infinity
          : p.y >= s.y - WALL_SNAP_DIST && p.y <= s.y + s.length + WALL_SNAP_DIST
            ? Math.abs(p.x - s.x)
            : Infinity
      if (dist <= bestDist) {
        bestDist = dist
        best = s
      }
    }
    return best
  }

  const openingTool = OPENING_TOOLS.find((o) => o.tool === tool) ?? null
  const isDrawTool =
    tool === 'wall' || tool === 'ground' || tool === 'counter' || Boolean(openingTool)

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
      setSegDraft({ kind: 'wall', x0: px, y0: py, dir: 'h', x: px, y: py, length: 0 })
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    if (openingTool) {
      const host = nearestWall(p)
      if (!host) {
        warn(openingTool.warn)
        return
      }
      // Fäst mot väggen: samma linje, startpunkt inom väggens utsträckning.
      const start =
        host.dir === 'h'
          ? clamp(snap(p.x), host.x, host.x + host.length)
          : clamp(snap(p.y), host.y, host.y + host.length)
      setSegDraft({
        kind: openingTool.kind,
        x0: host.dir === 'h' ? start : host.x,
        y0: host.dir === 'h' ? host.y : start,
        dir: host.dir,
        x: host.dir === 'h' ? start : host.x,
        y: host.dir === 'h' ? host.y : start,
        length: 0,
        hostWallId: host.id,
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
    if (segDraft) {
      const p = unproject(e.clientX, e.clientY)
      if (segDraft.hostWallId) {
        // Öppning: får bara växa längs värd-väggen.
        const host = floor.segments.find((s) => s.id === segDraft.hostWallId)
        if (!host) return
        const start = segDraft.dir === 'h' ? segDraft.x0 : segDraft.y0
        const cur =
          host.dir === 'h'
            ? clamp(snap(p.x), host.x, host.x + host.length)
            : clamp(snap(p.y), host.y, host.y + host.length)
        const lo = Math.min(start, cur)
        const len = Math.abs(cur - start)
        setSegDraft({
          ...segDraft,
          x: host.dir === 'h' ? lo : host.x,
          y: host.dir === 'h' ? host.y : lo,
          length: len,
        })
        return
      }
      const dx = clamp(snap(p.x), -HALF_W, HALF_W) - segDraft.x0
      const dy = clamp(snap(p.y), -HALF_H, HALF_H) - segDraft.y0
      if (Math.abs(dx) >= Math.abs(dy)) {
        const len = Math.abs(dx)
        setSegDraft({
          ...segDraft,
          dir: 'h',
          x: dx < 0 ? segDraft.x0 - len : segDraft.x0,
          y: segDraft.y0,
          length: len,
        })
      } else {
        const len = Math.abs(dy)
        setSegDraft({
          ...segDraft,
          dir: 'v',
          x: segDraft.x0,
          y: dy < 0 ? segDraft.y0 - len : segDraft.y0,
          length: len,
        })
      }
      return
    }
    const d = drag.current
    if (!d) return

    if (d.kind === 'seg-move' || d.kind === 'seg-end') {
      const p = unproject(e.clientX, e.clientY)
      patchFloor((fl) => ({
        segments: fl.segments.map((s) => {
          if (s.id !== d.id) return s
          if (d.kind === 'seg-move') {
            // Väggar flyttas fritt; öppningar glider längs sin egen linje.
            const nx = clamp(snap(p.x - d.offX), -HALF_W, HALF_W - (s.dir === 'h' ? s.length : 0))
            const ny = clamp(snap(p.y - d.offY), -HALF_H, HALF_H - (s.dir === 'v' ? s.length : 0))
            if (s.kind === 'wall') return { ...s, x: nx, y: ny }
            return s.dir === 'h' ? { ...s, x: nx } : { ...s, y: ny }
          }
          // seg-end: dra i ett ändhandtag för att göra väggen längre/kortare
          if (s.dir === 'h') {
            const pos = clamp(snap(p.x), -HALF_W, HALF_W)
            if (d.end === 'a') {
              const nx = Math.min(pos, s.x + s.length - GRID)
              return { ...s, x: nx, length: s.x + s.length - nx }
            }
            return { ...s, length: Math.max(GRID, pos - s.x) }
          }
          const pos = clamp(snap(p.y), -HALF_H, HALF_H)
          if (d.end === 'a') {
            const ny = Math.min(pos, s.y + s.length - GRID)
            return { ...s, y: ny, length: s.y + s.length - ny }
          }
          return { ...s, length: Math.max(GRID, pos - s.y) }
        }),
      }))
      return
    }

    const dx = (e.clientX - d.startX) / zoom
    const dy = (e.clientY - d.startY) / zoom
    const S = (-spin * Math.PI) / 180
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
        patchFloor((fl) => ({ grounds: [...fl.grounds, g] }))
        setSelection({ kind: 'ground', id: g.id })
        markDirty()
      }
      setGroundDraft(null)
      return
    }
    if (segDraft) {
      if (segDraft.length >= GRID) {
        const seg: WallSegment = {
          id: `s${nextId.current++}`,
          kind: segDraft.kind,
          dir: segDraft.dir,
          x: segDraft.x,
          y: segDraft.y,
          length: segDraft.length,
        }
        if (segDraft.hostWallId) {
          // Dela värd-väggen: väggbitar kvar på båda sidor om öppningen.
          patchFloor((fl) => {
            const host = fl.segments.find((s) => s.id === segDraft.hostWallId)
            if (!host) return { segments: [...fl.segments, seg] }
            const rest = fl.segments.filter((s) => s.id !== host.id)
            const start = host.dir === 'h' ? seg.x : seg.y
            const hostStart = host.dir === 'h' ? host.x : host.y
            const before = start - hostStart
            const after = hostStart + host.length - (start + seg.length)
            const pieces: WallSegment[] = []
            if (before >= GRID) {
              pieces.push({ ...host, id: `s${nextId.current++}`, length: before })
            }
            if (after >= GRID) {
              pieces.push({
                ...host,
                id: `s${nextId.current++}`,
                x: host.dir === 'h' ? start + seg.length : host.x,
                y: host.dir === 'h' ? host.y : start + seg.length,
                length: after,
              })
            }
            return { segments: [...rest, ...pieces, seg] }
          })
        } else {
          patchFloor((fl) => ({ segments: [...fl.segments, seg] }))
        }
        setSelection({ kind: 'segment', id: seg.id })
        markDirty()
      }
      setSegDraft(null)
      return
    }
    if (drag.current) {
      drag.current = null
      markDirty()
    }
  }

  function onElementPointerDown(
    e: ReactPointerEvent,
    kind: 'table' | 'fixture' | 'segment' | 'ground',
    id: string,
    origX = 0,
    origY = 0,
  ) {
    if (isDrawTool) return // ritverktyg aktivt — låt scenen ta över
    e.stopPropagation()
    if (tool === 'erase') {
      removeByKind(kind, id)
      return
    }
    setSelection({ kind, id } as Selection)
    if (kind === 'ground') return
    if (kind === 'segment') {
      const seg = floor.segments.find((s) => s.id === id)
      if (!seg) return
      const p = unproject(e.clientX, e.clientY)
      drag.current = {
        kind: 'seg-move',
        id,
        offX: p.x - seg.x,
        offY: p.y - seg.y,
      }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      return
    }
    drag.current = {
      kind,
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX,
      origY,
    }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  function onHandlePointerDown(
    e: ReactPointerEvent,
    segId: string,
    end: 'a' | 'b',
  ) {
    e.stopPropagation()
    drag.current = { kind: 'seg-end', id: segId, end }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  function removeByKind(
    kind: 'table' | 'fixture' | 'segment' | 'ground',
    id: string,
  ) {
    patchFloor((fl) => {
      if (kind === 'table') return { tables: fl.tables.filter((t) => t.id !== id) }
      if (kind === 'segment') return { segments: fl.segments.filter((s) => s.id !== id) }
      if (kind === 'fixture') return { fixtures: fl.fixtures.filter((f) => f.id !== id) }
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

  function updateSegmentLength(delta: number) {
    if (selection?.kind !== 'segment') return
    patchFloor((fl) => ({
      segments: fl.segments.map((s) => {
        if (s.id !== selection.id) return s
        const max = s.dir === 'h' ? HALF_W - s.x : HALF_H - s.y
        return { ...s, length: clamp(s.length + delta, GRID, max) }
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
      // Nya element börjar vid origo — canvasens mitt.
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
    setSegDraft(null)
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

  function publish() {
    setVersionLabel('Version 5 · Publicerad nyss')
    setStatusText('Publicerad — alla ändringar sparade (mock)')
  }

  const drawnSegments: (WallSegment & { draft?: boolean })[] = segDraft
    ? [...floor.segments, { id: '__draft', ...segDraft, draft: true }]
    : floor.segments
  const drawnGrounds: (GroundRect & { draft?: boolean })[] = groundDraft
    ? [...floor.grounds, { id: '__gdraft', ...groundDraft, draft: true }]
    : floor.grounds

  const floorIsEmpty =
    floor.grounds.length === 0 &&
    floor.segments.length === 0 &&
    floor.tables.length === 0 &&
    floor.fixtures.length === 0

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
            <button type="button" className="btn primary" onClick={publish}>
              Publicera layout
            </button>
          </span>
        }
      />
      <div className="admin-main">
        <div className="editor-row">
          <div className="admin-card editor-toolbar">
            <ToolButton glyph="↖" caption="Välj" title="Välj, flytta och ändra storlek" active={tool === 'select'} onClick={() => setTool('select')} />
            <ToolButton glyph="▦" caption="Mark" title="Rita mark — klicka och dra en yta" active={tool === 'ground'} onClick={() => setTool('ground')} />
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
                <button
                  type="button"
                  className="zoom-value"
                  title="Återställ zoom"
                  onClick={() => setManualZoom(1)}
                >
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
                      selection?.kind === 'ground' && selection.id === g.id
                        ? 'selected'
                        : '',
                      g.draft ? 'draft' : '',
                    ].join(' ')}
                    style={{
                      left: g.x + HALF_W,
                      top: g.y + HALF_H,
                      width: g.w,
                      height: g.h,
                    }}
                    onPointerDown={(e) => onElementPointerDown(e, 'ground', g.id)}
                  />
                ))}

                {drawnSegments.map((s) => (
                  <Segment
                    key={s.id}
                    seg={s}
                    selected={selection?.kind === 'segment' && selection.id === s.id}
                    showHandles={
                      tool === 'select' &&
                      selection?.kind === 'segment' &&
                      selection.id === s.id
                    }
                    onPointerDown={(e) => onElementPointerDown(e, 'segment', s.id)}
                    onHandlePointerDown={onHandlePointerDown}
                  />
                ))}

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
                    onPointerDown={(e) =>
                      onElementPointerDown(e, 'fixture', f.id, f.x, f.y)
                    }
                  >
                    <div className="fx-face back" />
                    <div className="fx-face left" />
                    <div className="fx-face right" />
                    <div className="fx-face front" />
                    <div className="fx-top" />
                    {/* Kassaapparaten på disken gör kassan tydlig i 3D */}
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
                        selection?.kind === 'table' && selection.id === t.id
                          ? 'selected'
                          : '',
                      ].join(' ')}
                      style={{
                        left: t.x - size.w / 2 + HALF_W,
                        top: t.y - size.h / 2 + HALF_H,
                        width: size.w,
                        height: size.h,
                        ['--th' as string]: `${TABLE_HEIGHT}px`,
                      }}
                      onPointerDown={(e) =>
                        onElementPointerDown(e, 'table', t.id, t.x, t.y)
                      }
                    >
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
                            <span className="table-seats">{t.seats} pl</span>
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
                  rita golvet. Bygg sedan väggar, fönster, entré och möblera.
                </p>
              </div>
            )}

            <p className={drawWarning ? 'scene-hint warning' : 'scene-hint'}>
              {drawWarning
                ? drawWarning
                : tool === 'ground'
                  ? 'Klicka och dra för att rita en markyta — flera ytor kan kombineras'
                  : openingTool
                    ? 'Klicka på en vägg och dra längs den för att placera öppningen'
                    : tool === 'wall'
                      ? 'Klicka och dra för att bygga — snappar till rutnätet'
                      : tool === 'counter'
                        ? 'Klicka för att placera kassan'
                        : 'Klicka för att välja · dra för att flytta · dra i handtagen för att ändra längd'}
            </p>
          </div>

          <aside className="admin-card props-panel">
            <div>
              <p className="props-kicker">VALT ELEMENT</p>
              <p className="props-title">
                {selectedTable
                  ? `Bord ${selectedTable.label.replace('T', '')}`
                  : selectedSegment
                    ? SEGMENT_LABEL[selectedSegment.kind]
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

            {selectedSegment && (
              <>
                <div className="props-field">
                  <p className="props-label">TYP</p>
                  <p className="props-pos">{SEGMENT_LABEL[selectedSegment.kind]}</p>
                </div>
                <div className="props-field">
                  <p className="props-label">LÄNGD</p>
                  <div className="seats-stepper">
                    <button type="button" className="step-btn" disabled={selectedSegment.length <= GRID} onClick={() => updateSegmentLength(-GRID)}>
                      –
                    </button>
                    <span>{selectedSegment.length}</span>
                    <button type="button" className="step-btn" onClick={() => updateSegmentLength(GRID)}>
                      +
                    </button>
                  </div>
                  <p className="props-empty">
                    {selectedSegment.dir === 'h' ? 'Vågrät' : 'Lodrät'} — dra i
                    handtagen i ändarna eller flytta hela genom att dra.
                  </p>
                </div>
                <div className="props-field">
                  <p className="props-label">POSITION</p>
                  <p className="props-pos">{`x: ${selectedSegment.x}   y: ${selectedSegment.y}`}</p>
                </div>
                <div className="props-divider" />
                <button type="button" className="btn danger-outline" onClick={() => removeByKind('segment', selectedSegment.id)}>
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

            {!selectedTable && !selectedSegment && !selectedFixture && !selectedGround && (
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
                  Origo (0,0) ligger i canvasens mitt och allt byggande utgår
                  därifrån. Nya våningar börjar tomma — rita marken först.
                  Fönster, entré och kökets ingång placeras på väggar och
                  delar dem automatiskt. Välj en vägg för att flytta den eller
                  dra i handtagen för att ändra längd.
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
          <span className="grow">{statusText}</span>
          <span>
            {floor.name} · Redigeras av Anna (personal)
          </span>
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
  for (const s of floor.segments) {
    if (s.dir === 'h') add(s.x, s.y, s.x + s.length, s.y)
    else add(s.x, s.y, s.x, s.y + s.length)
  }
  for (const f of floor.fixtures)
    add(f.x - f.w / 2, f.y - f.h / 2, f.x + f.w / 2, f.y + f.h / 2)
  for (const t of floor.tables) {
    const s = tableSize(t)
    add(t.x - s.w / 2, t.y - s.h / 2, t.x + s.w / 2, t.y + s.h / 2)
  }
  if (!Number.isFinite(minX)) {
    // Tom våning: visa en lagom yta kring origo (canvasens mitt).
    return { x: -400, y: -260, w: 800, h: 520 }
  }
  // Minsta vy så att en liten början inte blir enormt inzoomad.
  const w = Math.max(maxX - minX, 400)
  const h = Math.max(maxY - minY, 300)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/** Ett byggt segment: vägg, fönsterparti, entré eller kökets ingång. */
function Segment({
  seg,
  selected,
  showHandles,
  onPointerDown,
  onHandlePointerDown,
}: {
  seg: WallSegment & { draft?: boolean }
  selected: boolean
  showHandles: boolean
  onPointerDown: (e: ReactPointerEvent) => void
  onHandlePointerDown: (e: ReactPointerEvent, segId: string, end: 'a' | 'b') => void
}) {
  const t = WALL_THICKNESS
  const horizontal = seg.dir === 'h'
  const style = {
    left: (horizontal ? seg.x : seg.x - t / 2) + HALF_W,
    top: (horizontal ? seg.y - t / 2 : seg.y) + HALF_H,
    width: horizontal ? Math.max(seg.length, 2) : t,
    height: horizontal ? t : Math.max(seg.length, 2),
    ['--cap' as string]: `${seg.kind === 'entrance' ? 6 : WALL_HEIGHT}px`,
  }
  const faceA = horizontal ? 'h-n' : 'v-w'
  const faceB = horizontal ? 'h-s' : 'v-e'
  const faceSize = (h: number) =>
    horizontal ? { height: h } : { width: h }

  return (
    <div
      className={[
        'seg',
        seg.kind,
        selected ? 'selected' : '',
        seg.draft ? 'draft' : '',
      ].join(' ')}
      style={style}
      onPointerDown={onPointerDown}
    >
      {seg.kind === 'wall' && (
        <>
          <div className={`seg-face ${faceA}`} style={faceSize(WALL_HEIGHT)} />
          <div className={`seg-face ${faceB}`} style={faceSize(WALL_HEIGHT)} />
          <div className="seg-cap" style={{ ['--cap' as string]: `${WALL_HEIGHT}px` }} />
        </>
      )}

      {seg.kind === 'window' && (
        <>
          {/* murad bas + glas + överstycke */}
          <div className={`seg-face base ${faceA}`} style={faceSize(28)} />
          <div className={`seg-face base ${faceB}`} style={faceSize(28)} />
          <div
            className={`seg-face glass ${faceA}`}
            style={{ ...faceSize(48), ['--lift' as string]: '28px' }}
          />
          <div
            className={`seg-face base ${faceA}`}
            style={{ ...faceSize(14), ['--lift' as string]: '76px' }}
          />
          <div
            className={`seg-face base ${faceB}`}
            style={{ ...faceSize(14), ['--lift' as string]: '76px' }}
          />
          <div className="seg-cap" style={{ ['--cap' as string]: `${WALL_HEIGHT}px` }} />
        </>
      )}

      {seg.kind === 'entrance' && (
        <>
          <div className="seg-shadow" />
          <div className="seg-tag" style={{ ['--tagz' as string]: '4px' }}>
            <span>ENTRÉ</span>
          </div>
        </>
      )}

      {seg.kind === 'kitchen' && (
        <>
          <div className={`seg-face ${faceA}`} style={faceSize(WALL_HEIGHT)} />
          <div className={`seg-face ${faceB}`} style={faceSize(WALL_HEIGHT)} />
          <div className="seg-cap" style={{ ['--cap' as string]: `${WALL_HEIGHT}px` }} />
          <div className="seg-tag">
            <span>KÖK</span>
          </div>
        </>
      )}

      {showHandles && (
        <>
          <div
            className={`seg-handle ${horizontal ? 'h-a' : 'v-a'}`}
            title="Dra för att ändra längd"
            onPointerDown={(e) => onHandlePointerDown(e, seg.id, 'a')}
          />
          <div
            className={`seg-handle ${horizontal ? 'h-b' : 'v-b'}`}
            title="Dra för att ändra längd"
            onPointerDown={(e) => onHandlePointerDown(e, seg.id, 'b')}
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
