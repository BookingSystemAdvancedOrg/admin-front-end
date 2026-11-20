import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Floor, TableElement } from '../../layout-editor/data'
import { tableTitle } from '../../../shared/tables'
import type { Tab, TableState } from './types'
import './takeOrder.css'

/**
 * The published floor plan with every table tinted by what is happening
 * there right now: free (glass), booked now (amber, guest initials), open
 * order (accent, minutes since it opened) and a booking later today (dashed).
 * Used by the table picker in Ny bordsbeställning and by the Bord view in
 * Beställningar (admin-board imports it).
 */

export type MapTableState = 'free' | 'booked' | 'open' | 'upcoming'

export function tableMapState(table: TableState): MapTableState {
  if (table.tabId) return 'open'
  if (table.guest && !table.guest.upcoming) return 'booked'
  if (table.guest?.upcoming) return 'upcoming'
  return 'free'
}

export const MAP_STATE_TEXT: Record<MapTableState, string> = {
  free: 'Ledigt',
  booked: 'Bokat',
  open: 'Öppen',
  upcoming: 'Bokat senare',
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/** Whole minutes since an ISO time ("32 min", "1 h 5 min"). */
export function elapsed(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`
}

/** "18:00" from "18:00" or an ISO time. */
export function hhmm(time: string): string {
  const iso = /T(\d{2}:\d{2})/.exec(time)
  return iso ? iso[1]! : time.slice(0, 5)
}


/** Minutes since an ISO time, short enough for a table top ("32 min", "1:05 h"). */
export function elapsedShort(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`
}

/** The view box around everything drawn on a floor, with some air. */
function bounds(floor: Floor): { x: number; y: number; w: number; h: number } {
  const xs: number[] = []
  const ys: number[] = []
  for (const g of floor.grounds) {
    xs.push(g.x, g.x + g.w)
    ys.push(g.y, g.y + g.h)
  }
  for (const w of floor.walls) {
    xs.push(w.x, w.dir === 'h' ? w.x + w.length : w.x)
    ys.push(w.y, w.dir === 'v' ? w.y + w.length : w.y)
  }
  for (const t of floor.tables) {
    const r = Math.max(t.w, t.h) * 0.7 + 14
    xs.push(t.x - r, t.x + r)
    ys.push(t.y - r, t.y + r)
  }
  if (xs.length === 0) return { x: -200, y: -150, w: 400, h: 300 }
  const pad = 24
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

/*
 * Tables are real buttons laid over the drawn floor, sized in screen pixels:
 * the plan's geometry decides the size, but never below a size where the
 * number and seats sit with at least INSET px of air inside the shape. On a
 * narrow screen the plan never shrinks below the scale where two tables
 * would touch (minScale); it scrolls sideways instead.
 */
const INSET = 10
const MIN_ROUND = 68
const MIN_RECT_W = 64
const MIN_RECT_H = 56
/** Air between two tables on screen, at the smallest scale the plan may take. */
const GAP = 8
/** Height of the number + seats pair (number line, gap, seats line). */
const BLOCK_H = 34

interface Drawn {
  /** Shape size on screen (before rotation). */
  w: number
  h: number
  /** Box the button takes on screen (the rotated shape's bounds). */
  boxW: number
  boxH: number
  /** Widest the label may be and still keep INSET from the edge. */
  textW: number
  numSize: number
}

export function drawnSize(t: Pick<TableElement, 'w' | 'h' | 'shape' | 'rotation'>, scale: number): Drawn {
  const round = t.shape === 'round'
  let w: number
  let h: number
  if (round) {
    w = h = Math.max(MIN_ROUND, Math.max(t.w, t.h) * scale)
  } else {
    w = Math.max(MIN_RECT_W, t.w * scale)
    h = Math.max(MIN_RECT_H, t.h * scale)
  }
  const a = ((t.rotation % 360) + 360) % 360
  const rad = (a * Math.PI) / 180
  const boxW = round ? w : Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad))
  const boxH = round ? h : Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))
  let textW: number
  if (round) {
    // the widest line that keeps the whole text block INSET inside the circle
    const r = w / 2 - INSET
    textW = 2 * Math.sqrt(Math.max(0, r * r - (BLOCK_H / 2) ** 2))
  } else if (a % 180 === 0) {
    textW = w - 2 * INSET
  } else if (a % 90 === 0) {
    textW = h - 2 * INSET
  } else {
    textW = Math.min(w, h) - 2 * INSET
  }
  const inner = Math.min(w, h)
  const numSize = Math.round(Math.min(22, Math.max(16, inner * 0.3)))
  return { w, h, boxW, boxH, textW: Math.floor(textW), numSize }
}

/** The smallest scale at which no two drawn tables touch (GAP px apart). */
export function minScale(tables: Pick<TableElement, 'x' | 'y' | 'w' | 'h' | 'shape' | 'rotation'>[]): number {
  let need = 0
  for (let pass = 0; pass < 3; pass++) {
    const s = Math.max(need, 0.05)
    const d = tables.map((t) => drawnSize(t, s))
    let next = 0
    for (let i = 0; i < tables.length; i++) {
      for (let j = i + 1; j < tables.length; j++) {
        const dx = Math.abs(tables[i]!.x - tables[j]!.x)
        const dy = Math.abs(tables[i]!.y - tables[j]!.y)
        const sx = dx > 0 ? ((d[i]!.boxW + d[j]!.boxW) / 2 + GAP) / dx : Infinity
        const sy = dy > 0 ? ((d[i]!.boxH + d[j]!.boxH) / 2 + GAP) / dy : Infinity
        next = Math.max(next, Math.min(sx, sy))
      }
    }
    if (next <= need + 0.001) break
    need = next
  }
  return Number.isFinite(need) ? need : 1
}

export interface FloorMapProps {
  floors: Floor[]
  tables: TableState[]
  /** Open tabs, for the minutes since a table's order opened. */
  tabs: Tab[]
  now: number
  onPick: (table: TableState) => void
  selectedId?: string | null
  /** Tables that cannot be picked (e.g. Flytta: tables with an open order). */
  disabledIds?: ReadonlySet<string>
  /** Tables to draw attention to (a new order, a course ready to fire). */
  highlightIds?: ReadonlySet<string>
  label?: string
}

export function FloorMap({ floors, tables, tabs, now, onPick, selectedId, disabledIds, highlightIds, label = 'Bordskarta' }: FloorMapProps) {
  const byId = useMemo(() => new Map(tables.map((t) => [t.tableId, t])), [tables])
  const tabById = useMemo(() => new Map(tabs.map((t) => [t.tabId, t])), [tabs])
  const drawn = floors.filter((f) => f.tables.length > 0)
  const initial = drawn.find((f) => f.tables.some((t) => t.id === selectedId))?.id ?? drawn[0]?.id ?? null
  const [floorId, setFloorId] = useState<string | null>(initial)
  const floor = drawn.find((f) => f.id === floorId) ?? drawn[0]
  const view = floor ? bounds(floor) : null
  const floorMin = useMemo(() => (floor ? minScale(floor.tables) : 1), [floor])
  const wellRef = useRef<HTMLDivElement>(null)
  const [wellW, setWellW] = useState(0)

  useLayoutEffect(() => {
    const el = wellRef.current
    if (!el) return
    const measure = () => setWellW(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!floor || !view) return null

  // The plan fits the well's width and at most 64 % of the screen's height,
  // but never below the scale where tables would touch (then the well
  // scrolls sideways).
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight
  const fit = Math.min(wellW || view.w, (vh * 0.64 * view.w) / view.h)
  const stageW = Math.max(fit, view.w * floorMin)
  const scale = stageW / view.w

  const counts = (f: Floor) => f.tables.filter((t) => byId.get(t.id)?.tabId).length

  function cell(t: TableElement) {
    const state = byId.get(t.id)
    if (!state) return null
    const kind = tableMapState(state)
    const disabled = disabledIds?.has(t.id) ?? false
    const tab = state.tabId ? tabById.get(state.tabId) : undefined
    const d = drawnSize(t, scale)
    const sub =
      kind === 'open' ? (
        tab ? <span className="to-map-n">{elapsedShort(tab.openedAt, now)}</span> : MAP_STATE_TEXT.open
      ) : kind === 'booked' ? (
        initials(state.guest!.name)
      ) : kind === 'upcoming' ? (
        <span className="to-map-n">{hhmm(state.guest!.startTime)}</span>
      ) : (
        <>
          <span className="to-map-n">{state.seats}</span>
          <span className="to-map-unit">pl</span>
        </>
      )
    const name = tableTitle(state.label)
    const aria = [
      name,
      MAP_STATE_TEXT[kind],
      state.guest ? `${state.guest.name}, ${state.guest.partySize} pers${kind === 'upcoming' ? `, ${hhmm(state.guest.startTime)}` : ''}` : `${state.seats} platser`,
      tab ? `öppen ${elapsed(tab.openedAt, now)}` : '',
    ].filter(Boolean).join(', ')
    const style = {
      left: `${((t.x - view!.x) / view!.w) * 100}%`,
      top: `${((t.y - view!.y) / view!.h) * 100}%`,
      width: `${d.boxW}px`,
      height: `${d.boxH}px`,
      '--shape-w': `${d.w}px`,
      '--shape-h': `${d.h}px`,
      '--rot': `${t.rotation}deg`,
      '--text-w': `${d.textW}px`,
      '--num': `${d.numSize}px`,
    } as CSSProperties
    return (
      <button
        key={t.id}
        type="button"
        className={`to-map-table is-${kind} is-${t.shape === 'round' ? 'round' : 'rect'}${t.id === selectedId ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}${highlightIds?.has(t.id) ? ' is-highlight' : ''}`}
        style={style}
        disabled={disabled}
        aria-pressed={t.id === selectedId}
        aria-label={aria}
        data-table={t.id}
        onClick={() => !disabled && onPick(state)}
      >
        <span className="to-map-top" aria-hidden="true" />
        <span className="to-map-text" aria-hidden="true">
          <span className="to-map-label">{state.label}</span>
          <span className="to-map-sub">{sub}</span>
        </span>
      </button>
    )
  }

  return (
    <div className="to-map">
      {drawn.length > 1 && (
        <div className="to-seg to-map-floors" role="tablist" aria-label="Våning">
          {drawn.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={f.id === floor.id}
              className={f.id === floor.id ? 'active' : ''}
              onClick={() => setFloorId(f.id)}
            >
              {f.name}
              {counts(f) > 0 && <span className="to-count">{counts(f)}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="to-map-well" ref={wellRef}>
        <div
          className="to-map-stage"
          role="group"
          aria-label={`${label}, ${floor.name}`}
          style={{ width: `${stageW}px`, aspectRatio: `${view.w} / ${view.h}` }}
        >
          <svg
            className="to-map-plan"
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            {floor.grounds.map((g) => (
              <rect key={g.id} className="to-map-ground" x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
            ))}
            {floor.walls.map((w) => (
              <line
                key={w.id}
                className="to-map-wall"
                x1={w.x}
                y1={w.y}
                x2={w.dir === 'h' ? w.x + w.length : w.x}
                y2={w.dir === 'v' ? w.y + w.length : w.y}
              />
            ))}
          </svg>
          {floor.tables.map(cell)}
        </div>
      </div>
      <ul className="to-legend" aria-label="Förklaring">
        {(['free', 'booked', 'upcoming', 'open'] as const).map((k) => (
          <li key={k} className={`is-${k}`}>
            <span className="to-legend-swatch" aria-hidden="true" />
            {k === 'upcoming' ? 'Senare' : MAP_STATE_TEXT[k]}
          </li>
        ))}
      </ul>
    </div>
  )
}
