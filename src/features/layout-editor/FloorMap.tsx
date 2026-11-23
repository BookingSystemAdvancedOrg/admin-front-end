import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Floor, TableElement } from './data'
import './floor-map.css'

/** Hur ett bord ritas och vad ett tryck (eller Enter/mellanslag) gör. */
export interface TableView {
  /** Läget som klass (is-free, is-full ...); is-full och is-loading tar inte emot tryck på träffytan. */
  state: string
  selected: boolean
  /** Fler klasser efter de vanliga, med inledande mellanslag (" is-focus"). */
  extra?: string
  /** Går att nå med tabb. */
  focusable: boolean
  disabled: boolean
  /** Hela namnet för skärmläsare: "Bord 3, 4 pl, ledigt". */
  name: string
  onPick: () => void
}

/** Vy-rutan runt allt som är ritat på våningen, med lite luft. */
function floorBounds(floor: Floor): { x: number; y: number; w: number; h: number } {
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
    const r = Math.max(t.w, t.h) * 0.7 + 12
    xs.push(t.x - r, t.x + r)
    ys.push(t.y - r, t.y + r)
  }
  if (xs.length === 0) return { x: -200, y: -150, w: 400, h: 300 }
  const pad = 30
  const x = Math.min(...xs) - pad
  const y = Math.min(...ys) - pad
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
}

/**
 * Våningsflikarna ovanför kartan. En våning med något av `markIds` (bokningens
 * eller de valda borden) får klassen `markClass` (en prick i fliken) och
 * `markText` för skärmläsare.
 */
export function FloorTabs({
  floors,
  activeId,
  onPick,
  className = 'floor-tabs',
  markIds = [],
  markClass = 'has-linked',
  markText,
}: {
  floors: Floor[]
  activeId: string
  onPick: (id: string) => void
  className?: string
  markIds?: string[]
  markClass?: string
  markText?: string
}) {
  return (
    <div className={className} role="tablist" aria-label="Våning">
      {floors.map((f) => {
        const marked = f.tables.some((t) => markIds.includes(t.id))
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={f.id === activeId}
            className={`${f.id === activeId ? 'active' : ''}${marked ? ` ${markClass}` : ''}`}
            onClick={() => onPick(f.id)}
          >
            {f.name}
            {marked && markText && <span className="sr-only">{`, ${markText}`}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * En våning av den publicerade planen i 2D: golv, väggar och bord med
 * "Bord 3" och platser. Borden är knappar (tryck, Enter eller mellanslag);
 * runt varje bord ligger en större träffyta för fingret. Vad ett bord visar
 * och gör bestämmer sidan (`view`). Används av Layout (boka från kartan) och
 * bokningsformulären (välja bord).
 */
export function FloorMap({
  floor,
  label,
  view,
  className = 'floor-map',
  hitPad = 18,
  minHitPx,
  minSeatPx,
}: {
  floor: Floor
  /** Bordets nummer som gästerna ser det. */
  label: (t: TableElement) => string
  view: (t: TableElement) => TableView
  className?: string
  /** Hur långt utanför bordet träffytan når (i planens enheter). */
  hitPad?: number
  /** Träffytan är minst så här bred på skärmen (px), hur stort rummet än är. */
  minHitPx?: number
  /** Platsantalet är minst så här stort på skärmen (px); får det inte plats på bordet visas det inte (namnet har det). */
  minSeatPx?: number
}) {
  // Bordet vars träffyta pekaren står på: ytorna ligger under borden, så bordets :hover räcker inte.
  const [hoverId, setHoverId] = useState<string | null>(null)
  const box = floorBounds(floor)
  const views = new Map(floor.tables.map((t) => [t.id, view(t)]))
  const { ref, scale } = useScreenScale(box, Boolean(minHitPx || minSeatPx))
  // Planens enheter per skärmpixel, för borden (som ritas större i telefonen) och för träffytorna.
  const seatUnits = minSeatPx && scale ? minSeatPx / (scale.px * scale.body) : 0
  const hitUnits = minHitPx && scale ? minHitPx / 2 / scale.px : 0

  return (
    <svg
      ref={ref}
      className={className}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`Bord på ${floor.name}`}
    >
      {/* Fullbokat: randigt, samma ränder som i teckenförklaringen. */}
      <defs>
        <pattern id="floor-map-full" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="floor-map-full-base" width="8" height="8" />
          <rect className="floor-map-full-stripe" width="4" height="8" />
        </pattern>
      </defs>
      {floor.grounds.map((g) => (
        <rect key={g.id} className="floor-map-ground" x={g.x} y={g.y} width={g.w} height={g.h} />
      ))}
      {floor.walls.map((w) => (
        <line
          key={w.id}
          className="floor-map-wall"
          x1={w.x}
          y1={w.y}
          x2={w.dir === 'h' ? w.x + w.length : w.x}
          y2={w.dir === 'v' ? w.y + w.length : w.y}
        />
      ))}
      {/* Träffytorna runt borden ligger under alla bord: en grannes
          träffyta täcker aldrig ett bord (man träffar det man trycker på). */}
      {floor.tables.map((t) => {
        const v = views.get(t.id)!
        return (
          <circle
            key={`hit-${t.id}`}
            className={`floor-map-hit is-${v.state}`}
            data-table={t.id}
            cx={t.x}
            cy={t.y}
            r={Math.max(Math.max(t.w, t.h) / 2 + hitPad, hitUnits)}
            aria-hidden="true"
            onClick={v.onPick}
            onPointerEnter={() => setHoverId(t.id)}
            onPointerLeave={() => setHoverId((h) => (h === t.id ? null : h))}
          />
        )
      })}
      {floor.tables.map((t) => {
        const v = views.get(t.id)!
        const fit = labelFit(label(t), t, seatUnits)
        return (
          <g
            key={t.id}
            className={`floor-map-table is-${v.state}${v.selected ? ' is-selected' : ''}${t.id === hoverId ? ' is-hover' : ''}${v.extra ?? ''}`}
            transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}
            role="button"
            tabIndex={v.focusable ? 0 : -1}
            aria-disabled={v.disabled || undefined}
            aria-pressed={v.selected}
            aria-label={v.name}
            onClick={v.onPick}
            onKeyDown={(e: ReactKeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                v.onPick()
              }
            }}
          >
            <g className="floor-map-body">
              {t.shape === 'round' ? (
                <circle className="floor-map-top" r={Math.max(t.w, t.h) / 2} />
              ) : (
                <rect className="floor-map-top" x={-t.w / 2} y={-t.h / 2} width={t.w} height={t.h} rx={6} />
              )}
              <g transform={`rotate(${-t.rotation})`}>
                {fit.cut && <title>{label(t)}</title>}
                {/* Trailing space: screen readers and axe join the two texts, "T1 4 pl" not "T14 pl". */}
                <text className="floor-map-label" y={fit.y} style={fit.style}>
                  {fit.lines.length === 1
                    ? `${fit.lines[0]} `
                    : fit.lines.map((line, i) => (
                        <tspan key={i} x={0} dy={i === 0 ? 0 : fit.size * 1.1}>
                          {i === fit.lines.length - 1 ? `${line} ` : line}
                        </tspan>
                      ))}
                </text>
                {fit.seats && (
                  <text className="floor-map-seats" y={fit.seatsY} style={fit.seatsStyle}>
                    {t.seats} pl
                  </text>
                )}
              </g>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Hur stor planen är på skärmen: pixlar per enhet (vy-rutan, "meet") och hur
 * mycket borden förstoras i telefonen (CSS scale på .floor-map-body). Mäts
 * bara när sidan bett om minsta storlekar; null innan första mätningen.
 */
function useScreenScale(box: { w: number; h: number }, on: boolean) {
  const ref = useRef<SVGSVGElement>(null)
  const [scale, setScale] = useState<{ px: number; body: number } | null>(null)
  const { w, h } = box
  useEffect(() => {
    const svg = ref.current
    if (!on || !svg || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const r = svg.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      const px = Math.min(r.width / w, r.height / h)
      const bodyEl = svg.querySelector('.floor-map-body')
      const body = (bodyEl && parseFloat(getComputedStyle(bodyEl).scale)) || 1
      setScale((s) => (s && Math.abs(s.px - px) < 0.005 && s.body === body ? s : { px, body }))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [on, w, h])
  return { ref, scale }
}

/**
 * Bordsnumret ska rymmas på bordet och gå att läsa: ett långt namn får mindre
 * text (ned till 13, inte mindre). Räcker inte det bryts det på två rader om
 * bordet är högt nog, annars kortas det med "…"; hela namnet ligger då i en
 * title. Bara utseende.
 */
function labelFit(text: string, t: { w: number; h: number; rotation: number; seats: number }, minSeat = 0) {
  const upright = t.rotation % 180 === 0
  const room = (upright ? t.w : Math.min(t.w, t.h)) - 10
  const tall = upright ? t.h : t.w
  const perChar = 0.62
  const max = 19
  const min = 13
  // Två rader får vara något mindre än en rad; de syns ändå tydligt.
  const small = 10
  const fits = (n: number, cap = max) => Math.min(cap, room / Math.max(1, n * perChar))
  /**
   * En rad: platsantalet under numret, båda inne på bordet. Ett lågt bord
   * flyttar upp dem. Med en minsta storlek (`minSeat`) som inte ryms på
   * bordet visas inget platsantal.
   */
  const oneLine = (size: number) => {
    // Platsantalet är 12 enheter (CSS), större när skärmen kräver det.
    const seat = Math.max(12, minSeat)
    const seatsY = Math.min(14 + (seat - 12) / 2, tall / 2 - 1 - seat / 2)
    const y = Math.min(-4, seatsY - seat / 2 - 1 - size / 2)
    // "4 pl" är smalare per tecken än ett bordsnamn.
    const wide = `${t.seats} pl`.length * 0.55 * seat <= room + 6
    const fitsAll = wide && y - size / 2 >= -tall / 2 + 1
    const seats = minSeat === 0 || fitsAll
    return {
      y: seats ? y : 0,
      seatsY,
      seats,
      seatsStyle: minSeat > 12 ? { fontSize: `${seat}px` } : undefined,
    }
  }
  const one = fits(text.length)
  if (one >= min) {
    return {
      size: one,
      lines: [text],
      cut: false,
      ...oneLine(one),
      style: one < max ? { fontSize: `${one}px` } : undefined,
    }
  }
  // Två rader och platsantalet under ska rymmas på höjden.
  const twoCap = Math.min(max, (tall - 18) / 2.2)
  if (twoCap < small) {
    // Bara en rad: början och slutet syns, så numret i "Terrassen 12" finns kvar.
    const per = Math.max(3, Math.floor(room / (perChar * min)))
    const head = Math.ceil((per - 1) / 2)
    const tail = per - 1 - head
    const short = `${text.slice(0, head).trimEnd()}…${tail > 0 ? text.slice(-tail).trimStart() : ''}`
    return { size: min, lines: [short], cut: true, ...oneLine(min), style: { fontSize: `${min}px` } }
  }
  // Bryt vid det mellanslag som ger jämnast rader.
  let lines: string[] | null = null
  for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) {
    const cand = [text.slice(0, i), text.slice(i + 1)]
    if (!lines || Math.max(...cand.map((l) => l.length)) < Math.max(...lines.map((l) => l.length))) lines = cand
  }
  let cut = false
  if (!lines || fits(Math.max(...lines.map((l) => l.length)), twoCap) < small) {
    const per = Math.max(3, Math.floor(room / (perChar * small)))
    if (text.length <= 2 * per - 1) {
      // Mitt i ordet med bindestreck.
      lines = [`${text.slice(0, per - 1)}-`, text.slice(per - 1)]
    } else {
      // För långt även på två rader: början och slutet, hela namnet i title.
      const space = text.lastIndexOf(' ', per)
      const first = space > per / 3 ? text.slice(0, space) : text.slice(0, per)
      lines = [first, `…${text.slice(-(per - 1)).trimStart()}`]
      cut = true
    }
  }
  const size = Math.max(small, fits(Math.max(...lines.map((l) => l.length)), twoCap))
  // Blocket (två rader, 2 enheter luft, platsantalet 12) centreras på bordet.
  const top = -(2 * 1.1 * size + 2 + 12) / 2
  return {
    size,
    lines,
    cut,
    y: top + 0.55 * size,
    seatsY: top + 2.2 * size + 8,
    seats: true,
    seatsStyle: undefined,
    style: { fontSize: `${size}px` },
  }
}
