import { useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Floor, TableElement } from '../../layout-editor/data'
import { tableTitle } from '../../../shared/tables'
import type { Tab, TableState } from './types'
import './takeOrder.css'

/**
 * The published floor plan with every table coloured by what is happening
 * there right now: free (glass), booked now (amber, guest initials), open
 * order (wine, minutes since it opened) and a booking later today (outline).
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
  if (!floor || !view) return null

  const counts = (f: Floor) => f.tables.filter((t) => byId.get(t.id)?.tabId).length

  function cell(t: TableElement) {
    const state = byId.get(t.id)
    if (!state) return null
    const kind = tableMapState(state)
    const disabled = disabledIds?.has(t.id) ?? false
    const tab = state.tabId ? tabById.get(state.tabId) : undefined
    const sub =
      kind === 'open'
        ? tab ? elapsed(tab.openedAt, now) : MAP_STATE_TEXT.open
        : kind === 'booked'
          ? initials(state.guest!.name)
          : kind === 'upcoming'
            ? hhmm(state.guest!.startTime)
            : `${state.seats} pl`
    const name = tableTitle(state.label)
    const aria = [
      name,
      MAP_STATE_TEXT[kind],
      state.guest ? `${state.guest.name}, ${state.guest.partySize} pers${kind === 'upcoming' ? `, ${hhmm(state.guest.startTime)}` : ''}` : `${state.seats} platser`,
      tab ? `öppen ${elapsed(tab.openedAt, now)}` : '',
    ].filter(Boolean).join(', ')
    const pick = () => !disabled && onPick(state)
    const r = Math.max(t.w, t.h) / 2
    return (
      <g
        key={t.id}
        className={`to-map-table is-${kind}${t.id === selectedId ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}${highlightIds?.has(t.id) ? ' is-highlight' : ''}`}
        transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-pressed={t.id === selectedId}
        aria-label={aria}
        data-table={t.id}
        onClick={pick}
        onKeyDown={(e: ReactKeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pick()
          }
        }}
      >
        {t.shape === 'round' ? (
          <circle className="to-map-top" r={r} />
        ) : (
          <rect className="to-map-top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={8} />
        )}
        <g transform={`rotate(${-t.rotation})`}>
          <text className="to-map-label" y={-5}>
            {state.label}{' '}
          </text>
          <text className="to-map-sub" y={13}>
            {sub}
          </text>
        </g>
      </g>
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
      <svg
        className="to-map-svg"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`${label}, ${floor.name}`}
      >
        {floor.grounds.map((g) => (
          <rect key={g.id} className="to-map-ground" x={g.x} y={g.y} width={g.w} height={g.h} rx={6} />
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
        {/* Bigger targets than the tables, for fingers; under every table so a
            neighbour's target never covers a table. */}
        {floor.tables.map((t) => {
          const state = byId.get(t.id)
          if (!state || disabledIds?.has(t.id)) return null
          return (
            <circle key={`hit-${t.id}`} className="to-map-hit" cx={t.x} cy={t.y} r={Math.max(t.w, t.h) / 2 + 16}
              aria-hidden="true" onClick={() => onPick(state)} />
          )
        })}
        {floor.tables.map(cell)}
      </svg>
      <div className="to-legend" aria-hidden="true">
        <span className="is-free">Ledigt</span>
        <span className="is-booked">Bokat</span>
        <span className="is-upcoming">Senare</span>
        <span className="is-open">Öppen</span>
      </div>
    </div>
  )
}
