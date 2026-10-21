import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { reducedMotion } from '../../shared/motion/countUp'
import { niceMax, tickLabel } from './chartScale'
import { fmtPct } from './stats'

/**
 * Små SVG-diagram i admin-panelens tryckstil, utan beroenden: bläck på
 * papper, skrivarens röda för det som sticker ut, stål för förra perioden.
 * Varje diagram ritas i kortets verkliga bredd (texten behåller sin
 * storlek på mobil), namnger sina värden för skärmläsare och har en tabell
 * bakom "Visa som tabell". Staplarna växer upp en gång; med "minska
 * rörelse" står allt stilla.
 */

const H = 220
const PAD = { top: 16, right: 12, bottom: 30, left: 52 }

function useWidth(fallback = 640): [RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setWidth(Math.max(260, Math.round(el.getBoundingClientRect().width) || fallback))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fallback])
  return [ref, width]
}

/** Tabellen bakom varje diagram, för skärmläsare och för den som vill ha siffrorna. */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="sk-table">
      <summary>Visa som tabell</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="sk-empty">{text}</p>
}

export interface ColumnPoint {
  key: string
  /** Kort etikett under stapeln. */
  label: string
  value: number
  /** Samma mått i förra perioden (ritas som en stålgrå linje). */
  previous?: number
  /** Text för tabellen och verktygstipset. */
  title: string
}

/** Stående staplar per dag, förra perioden som en grå linje över samma dagar. */
export function ColumnChart({
  points,
  unit,
  format,
  ariaLabel,
  seriesLabel,
  previousLabel,
  tableHead,
  tableRows,
}: {
  points: ColumnPoint[]
  unit: 'kr' | 'count'
  format: (v: number) => string
  ariaLabel: string
  seriesLabel: string
  previousLabel?: string
  tableHead: string[]
  tableRows: (string | number)[][]
}) {
  const id = useId()
  const [ref, W] = useWidth()
  if (points.length === 0 || points.every((p) => p.value === 0 && !p.previous)) return <Empty text="Inget att visa i perioden." />
  const hasPrev = points.some((p) => p.previous !== undefined)
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.value, p.previous ?? 0)), 1))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / points.length
  const barW = Math.max(4, Math.min(30, slot * 0.62))
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / max) * innerH
  const x = (i: number) => PAD.left + slot * i + slot / 2
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const labelEvery = Math.ceil(points.length / Math.max(3, Math.floor(innerW / 64)))
  const peak = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0)
  const line = hasPrev
    ? points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.previous ?? 0).toFixed(1)}`)
        .join(' ')
    : ''
  return (
    <figure className="sk-chart" ref={ref as RefObject<HTMLElement>}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={`${id}-t`} className="sk-svg">
        <title id={`${id}-t`}>{ariaLabel}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="sk-grid" />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="sk-tick">
              {tickLabel(t, unit)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.key}>
            <rect
              x={x(i) - barW / 2}
              y={y(p.value)}
              width={barW}
              height={Math.max(0, PAD.top + innerH - y(p.value))}
              rx={2}
              className={`sk-bar sk-bar--grow${i === peak && p.value > 0 ? ' sk-bar--peak' : ''}`}
              style={{ '--i': i } as CSSProperties}
            >
              <title>{p.title}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - 10} textAnchor="middle" className="sk-tick">
                {p.label}
              </text>
            )}
            {i === peak && p.value > 0 && (
              <text x={x(i)} y={y(p.value) - 6} textAnchor="middle" className="sk-value">
                {format(p.value)}
              </text>
            )}
          </g>
        ))}
        {hasPrev && <path d={line} pathLength={1} className="sk-line sk-line--draw" />}
        {hasPrev &&
          points.map((p, i) => (
            <circle key={p.key} cx={x(i)} cy={y(p.previous ?? 0)} r={2.4} className="sk-dot sk-dot--in" style={{ '--i': i } as CSSProperties} />
          ))}
      </svg>
      <figcaption className="sk-legend">
        <span>
          <i className="sk-swatch sk-swatch--ink" aria-hidden="true" />
          {seriesLabel}
        </span>
        {hasPrev && previousLabel && (
          <span>
            <i className="sk-swatch sk-swatch--line" aria-hidden="true" />
            {previousLabel}
          </span>
        )}
      </figcaption>
      <ChartTable caption={ariaLabel} head={tableHead} rows={tableRows} />
    </figure>
  )
}

export interface BarRow {
  key: string
  label: string
  value: number
  title: string
}

/** Liggande staplar (timmar, veckodagar): den största i rött, värdet vid spetsen. */
export function BarChart({ rows, format, ariaLabel, tableHead, tableRows }: {
  rows: BarRow[]
  format: (v: number) => string
  ariaLabel: string
  tableHead: string[]
  tableRows: (string | number)[][]
}) {
  const id = useId()
  const [ref, W] = useWidth()
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <Empty text="Inget att visa i perioden." />
  const max = Math.max(...rows.map((r) => r.value), 1)
  const rowH = 26
  const labelW = 44
  const valueW = 56
  const h = rows.length * rowH + 6
  const innerW = Math.max(40, W - labelW - valueW - 8)
  const peak = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0)
  return (
    <figure className="sk-chart" ref={ref as RefObject<HTMLElement>}>
      <svg viewBox={`0 0 ${W} ${h}`} width={W} height={h} role="img" aria-labelledby={`${id}-t`} className="sk-svg">
        <title id={`${id}-t`}>{ariaLabel}</title>
        {rows.map((r, i) => {
          const w = (r.value / max) * innerW
          const cy = i * rowH + rowH / 2 + 3
          return (
            <g key={r.key}>
              <text x={labelW - 8} y={cy + 4} textAnchor="end" className="sk-tick">
                {r.label}
              </text>
              <rect
                x={labelW}
                y={cy - 8}
                width={Math.max(r.value > 0 ? 3 : 0, w)}
                height={16}
                rx={2}
                className={`sk-bar sk-bar--row${i === peak ? ' sk-bar--peak' : ''}`}
                style={{ '--i': i } as CSSProperties}
              >
                <title>{r.title}</title>
              </rect>
              <text x={labelW + Math.max(r.value > 0 ? 3 : 0, w) + 8} y={cy + 4} className="sk-value">
                {r.value > 0 ? format(r.value) : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <ChartTable caption={ariaLabel} head={tableHead} rows={tableRows} />
    </figure>
  )
}

/* --- Ringen ---------------------------------------------------------------- */

export type RingTone = 'ink' | 'red' | 'steel'

export interface RingSegment {
  key: string
  label: string
  value: number
  tone: RingTone
}

const SIZE = 150
const R = 58
const C = 2 * Math.PI * R

/**
 * En ring som delar en helhet i några delar, med den första delens andel i
 * mitten och en förklaring som skriver ut varje andel, så att färgen aldrig
 * är enda signalen. Bågarna växer in en gång när ringen visas.
 */
export function Ring({ title, segments, total, centerLabel, empty, format }: {
  title: string
  segments: RingSegment[]
  total: number
  centerLabel: string
  empty: string
  format: (n: number) => string
}) {
  const id = useId()
  const [grown, setGrown] = useState(() => reducedMotion())
  useEffect(() => {
    if (grown) return
    const t = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(t)
  }, [grown])
  const shares = segments.map((s) => ({ ...s, share: total > 0 ? Math.max(0, Math.min(1, Math.max(0, s.value) / total)) : 0 }))
  const hero = shares[0]
  // Varje båge börjar där den förra slutade.
  const starts = shares.reduce<number[]>((acc, _s, i) => [...acc, (acc[i - 1] ?? 0) + (i > 0 ? C * shares[i - 1].share : 0)], [])
  const arcs = shares.map((s, i) => {
    const length = grown ? C * s.share : 0
    return { ...s, dash: `${length} ${Math.max(0, C - length)}`, offset: -starts[i] }
  })
  return (
    <figure className="sk-ring" aria-labelledby={`${id}-t`}>
      <figcaption className="sk-ring-title" id={`${id}-t`}>
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="sk-ring-svg"
        role="img"
        aria-label={`${title}: ${shares.map((s) => `${s.label} ${total > 0 ? fmtPct(s.share * 100) : '-'}`).join(', ')}`}
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="sk-ring-track" />
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              className={`sk-ring-seg sk-ring-seg--${a.tone}`}
              strokeDasharray={a.dash}
              strokeDashoffset={a.offset}
            />
          ))}
        </g>
        {total > 0 && hero ? (
          <>
            <text x={SIZE / 2} y={SIZE / 2 - 2} textAnchor="middle" className="sk-ring-value">
              {fmtPct(hero.share * 100)}
            </text>
            <text x={SIZE / 2} y={SIZE / 2 + 18} textAnchor="middle" className="sk-ring-center">
              {centerLabel}
            </text>
          </>
        ) : (
          <text x={SIZE / 2} y={SIZE / 2 + 4} textAnchor="middle" className="sk-ring-center">
            {empty}
          </text>
        )}
      </svg>
      <ul className="sk-ring-legend">
        {shares.map((s) => (
          <li key={s.key}>
            <i className={`sk-swatch sk-swatch--${s.tone}`} aria-hidden="true" />
            <span className="sk-ring-label">{s.label}</span>
            <span className="sk-ring-pct">{total > 0 ? fmtPct(s.share * 100) : '-'}</span>
            <span className="sk-ring-amount">{format(s.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/* --- Förändringen mot förra perioden ---------------------------------------- */

/** "+12 % mot förra perioden" som en stämpel; `invert` när lägre är bättre. */
export function Delta({ pct, invert = false, pending = false, children }: { pct: number | null; invert?: boolean; pending?: boolean; children?: ReactNode }) {
  if (pending) return <span className="sk-delta sk-delta--none">jämför med förra perioden…</span>
  if (pct === null) return <span className="sk-delta sk-delta--none">ingen förra period att jämföra med</span>
  const flat = Math.abs(pct) < 0.5
  const good = invert ? pct < 0 : pct > 0
  const tone = flat ? 'flat' : good ? 'good' : 'bad'
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : ''
  return (
    <span className={`sk-delta sk-delta--${tone}`}>
      {flat ? 'oförändrat' : `${sign}${fmtPct(Math.abs(pct))}`}
      <span className="sk-delta-label">{children ?? 'mot förra perioden'}</span>
    </span>
  )
}
