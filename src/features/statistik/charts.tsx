import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { ChartTip } from '../../shared/ChartTip'
import { useChartTip } from '../../shared/chartTipState'
import type { TipContent } from '../../shared/chartTipState'
import { reducedMotion } from '../../shared/motion/countUp'
import { heatStep, niceMax, tickLabel } from './chartScale'
import { fmtPct } from './stats'

/**
 * Små SVG-diagram i admin-panelens tryckstil, utan beroenden: bläck på
 * papper, skrivarens röda för det som sticker ut, stål för förra perioden.
 * Varje diagram ritas i kortets verkliga bredd (texten behåller sin
 * storlek på mobil), namnger sina värden för skärmläsare och har en tabell
 * bakom "Visa som tabell". Staplarna växer upp en gång; med "minska
 * rörelse" står allt stilla. Varje punkt visar ett verktygstips vid hovring,
 * tryck och tangentbord (ChartTip).
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
  /** Hela meningen, för skärmläsare. */
  title: string
  /** Extra rad i verktygstipset, t.ex. "i 12 bokningar". */
  detail?: string
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
  const tip = useChartTip(points.length)
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
  const a = tip.active
  const ap = a !== null ? points[a] : null
  const content: TipContent | null = ap
    ? {
        heading: ap.label,
        rows: [
          { label: seriesLabel, value: format(ap.value), tone: 'ink' },
          ...(hasPrev && ap.previous !== undefined ? [{ label: previousLabel ?? 'Förra perioden', value: format(ap.previous), tone: 'line' as const }] : []),
        ],
        note: ap.detail,
      }
    : null
  return (
    <figure className="sk-chart chart-tip-host" ref={ref as RefObject<HTMLElement>}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-labelledby={`${id}-t`}
        className="sk-svg chart-tip-surface"
        {...tip.surface}
      >
        <title id={`${id}-t`}>{ariaLabel}</title>
        {a !== null && <rect x={PAD.left + slot * a} y={PAD.top} width={slot} height={innerH} className="chart-band" />}
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
            />
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
        {points.map((p, i) => (
          <rect key={p.key} x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH + PAD.bottom} className="chart-hit" {...tip.hit(i)} />
        ))}
      </svg>
      <ChartTip
        tip={tip}
        at={ap ? { x: x(a!), y: Math.min(y(ap.value), hasPrev ? y(ap.previous ?? 0) : Infinity) } : null}
        content={content}
      />
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
  /** Hela meningen, för skärmläsare. */
  title: string
  /** Etiketten i verktygstipset när den korta etiketten inte räcker ("Förfr." blir "Förfrågningar"). */
  heading?: string
  /** Extra rad i verktygstipset, t.ex. "8 gäster". */
  detail?: string
}

/** Liggande staplar (timmar, veckodagar): den största i rött, värdet vid spetsen. */
export function BarChart({ rows, format, seriesLabel, ariaLabel, tableHead, tableRows }: {
  rows: BarRow[]
  format: (v: number) => string
  /** Vad värdet är ("Bokningar", "Beläggning"), i verktygstipset. */
  seriesLabel: string
  ariaLabel: string
  tableHead: string[]
  tableRows: (string | number)[][]
}) {
  const id = useId()
  const [ref, W] = useWidth()
  const tip = useChartTip(rows.length)
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <Empty text="Inget att visa i perioden." />
  const max = Math.max(...rows.map((r) => r.value), 1)
  const rowH = 26
  // Etiketterna får plats ("Samma dag", "Större bord"); mono, ungefär 7,5 px per tecken.
  const labelW = Math.min(120, Math.max(44, Math.max(...rows.map((r) => r.label.length)) * 7.5 + 10))
  const valueW = 56
  const h = rows.length * rowH + 6
  const innerW = Math.max(40, W - labelW - valueW - 8)
  const peak = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0)
  const a = tip.active
  const ar = a !== null ? rows[a] : null
  const cyOf = (i: number) => i * rowH + rowH / 2 + 3
  return (
    <figure className="sk-chart chart-tip-host" ref={ref as RefObject<HTMLElement>}>
      <svg
        viewBox={`0 0 ${W} ${h}`}
        width={W}
        height={h}
        role="img"
        aria-labelledby={`${id}-t`}
        className="sk-svg chart-tip-surface"
        {...tip.surface}
      >
        <title id={`${id}-t`}>{ariaLabel}</title>
        {a !== null && <rect x={0} y={a * rowH + 3} width={W} height={rowH} rx={2} className="chart-band" />}
        {rows.map((r, i) => {
          const w = (r.value / max) * innerW
          const cy = cyOf(i)
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
              />
              <text x={labelW + Math.max(r.value > 0 ? 3 : 0, w) + 8} y={cy + 4} className="sk-value">
                {r.value > 0 ? format(r.value) : ''}
              </text>
            </g>
          )
        })}
        {rows.map((r, i) => (
          <rect key={r.key} x={0} y={i * rowH + 3} width={W} height={rowH} className="chart-hit" {...tip.hit(i)} />
        ))}
      </svg>
      <ChartTip
        tip={tip}
        at={ar ? { x: labelW + Math.max(ar.value > 0 ? 3 : 0, (ar.value / max) * innerW) / 2, y: cyOf(a!) - 8 } : null}
        content={ar ? { heading: ar.heading ?? ar.label, rows: [{ label: seriesLabel, value: format(ar.value), tone: a === peak ? 'red' : 'ink' }], note: ar.detail } : null}
      />
      <ChartTable caption={ariaLabel} head={tableHead} rows={tableRows} />
    </figure>
  )
}

/* --- Ringen ---------------------------------------------------------------- */

export type RingTone = 'ink' | 'red' | 'steel' | 'muted'

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
export function Ring({ title, segments, total, centerLabel, empty, format, valueLabel = 'Antal' }: {
  title: string
  segments: RingSegment[]
  total: number
  centerLabel: string
  empty: string
  format: (n: number) => string
  /** Vad värdet är i verktygstipset ("Antal", "Belopp"). */
  valueLabel?: string
}) {
  const id = useId()
  const [grown, setGrown] = useState(() => reducedMotion())
  const tip = useChartTip(total > 0 ? segments.length : 0)
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
  // Bågen under pekaren: vinkeln från mitten (medurs från klockan tolv) och
  // avståndet till ringen, så att mitten och hörnen inte räknas.
  const pick = (e: { clientX: number; clientY: number }) => {
    const svg = tip.svg
    if (!svg || total <= 0) return
    const r = svg.getBoundingClientRect()
    const dx = ((e.clientX - r.left) / r.width) * SIZE - SIZE / 2
    const dy = ((e.clientY - r.top) / r.height) * SIZE - SIZE / 2
    const dist = Math.hypot(dx, dy)
    if (dist < R - 16 || dist > R + 16) return tip.set(null)
    const turn = ((Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)
    const i = shares.findIndex((_s, k) => turn * C >= starts[k] && turn * C < starts[k] + C * shares[k].share)
    tip.set(i >= 0 ? i : null)
  }
  const a = tip.active
  const as = a !== null ? shares[a] : null
  const mid = as ? ((starts[a!] + (C * as.share) / 2) / C) * 2 * Math.PI - Math.PI / 2 : 0
  return (
    <figure className="sk-ring chart-tip-host" aria-labelledby={`${id}-t`}>
      <figcaption className="sk-ring-title" id={`${id}-t`}>
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="sk-ring-svg chart-tip-surface"
        role="img"
        aria-label={`${title}: ${shares.map((s) => `${s.label} ${total > 0 ? fmtPct(s.share * 100) : '-'}`).join(', ')}`}
        {...tip.surface}
        onPointerMove={pick}
        onPointerDown={pick}
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} className="sk-ring-track" />
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {arcs.map((arc, i) => (
            <circle
              key={arc.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              className={`sk-ring-seg sk-ring-seg--${arc.tone}${a === i ? ' sk-ring-seg--on' : ''}`}
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
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
      <ChartTip
        tip={tip}
        at={as ? { x: SIZE / 2 + Math.cos(mid) * R, y: SIZE / 2 + Math.sin(mid) * R - 8 } : null}
        content={
          as
            ? {
                heading: as.label,
                rows: [
                  { label: 'Andel', value: fmtPct(as.share * 100), tone: as.tone },
                  { label: valueLabel, value: format(as.value) },
                ],
              }
            : null
        }
      />
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

/* --- Värmekartan: veckodag x timme ------------------------------------------- */

export interface HeatCell {
  row: number
  col: number
  value: number | null
  title: string
}

/**
 * Beläggning per veckodag och timme. Varje ruta skriver ut sitt värde, så
 * styrkan aldrig är enda signalen; tabellen ligger bakom "Visa som tabell".
 */
export function Heatmap({ rows, cols, cells, ariaLabel, tableHead, tableRows }: {
  rows: string[]
  cols: string[]
  cells: HeatCell[]
  ariaLabel: string
  tableHead: string[]
  tableRows: (string | number)[][]
}) {
  const id = useId()
  const [ref, W] = useWidth()
  const tip = useChartTip(rows.length * cols.length, cols.length)
  if (cells.length === 0 || cols.length === 0) return <Empty text="Inga öppettider eller bord att räkna på i perioden." />
  const labelW = 40
  const top = 22
  const gap = 2
  const cellW = Math.max(18, Math.floor((W - labelW) / cols.length) - gap)
  const cellH = 28
  const width = labelW + cols.length * (cellW + gap)
  const height = top + rows.length * (cellH + gap)
  const byKey = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]))
  const showValues = cellW >= 26
  const labelEvery = cellW >= 30 ? 1 : 2
  const a = tip.active
  const ar = a !== null ? Math.floor(a / cols.length) : 0
  const ac = a !== null ? a % cols.length : 0
  const acell = a !== null ? byKey.get(`${ar}|${ac}`) : undefined
  const avalue = acell && acell.value !== null ? fmtPct(acell.value) : 'Stängt'
  return (
    <figure className="sk-chart sk-heat chart-tip-host" ref={ref as RefObject<HTMLElement>}>
      <div className="sk-heat-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-labelledby={`${id}-t`}
          className="sk-svg chart-tip-surface"
          {...tip.surface}
        >
          <title id={`${id}-t`}>{ariaLabel}</title>
          {cols.map((c, j) =>
            j % labelEvery === 0 ? (
              <text key={c} x={labelW + j * (cellW + gap) + cellW / 2} y={14} textAnchor="middle" className="sk-tick">
                {c}
              </text>
            ) : null,
          )}
          {rows.map((r, i) => (
            <g key={r}>
              <text x={labelW - 8} y={top + i * (cellH + gap) + cellH / 2 + 4} textAnchor="end" className="sk-tick">
                {r}
              </text>
              {cols.map((c, j) => {
                const cell = byKey.get(`${i}|${j}`)
                const step = heatStep(cell?.value ?? null)
                const x = labelW + j * (cellW + gap)
                const y = top + i * (cellH + gap)
                return (
                  <g key={c}>
                    <rect
                      x={x}
                      y={y}
                      width={cellW}
                      height={cellH}
                      rx={2}
                      className={`sk-heat-cell sk-heat-cell--${step < 0 ? 'none' : step}${a === i * cols.length + j ? ' sk-heat-cell--on' : ''}`}
                      {...tip.hit(i * cols.length + j)}
                    />
                    {showValues && cell && cell.value !== null && (
                      <text x={x + cellW / 2} y={y + cellH / 2 + 4} textAnchor="middle" className={`sk-heat-value${step >= 3 ? ' sk-heat-value--on' : ''}`}>
                        {Math.round(cell.value)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          ))}
        </svg>
      </div>
      <ChartTip
        tip={tip}
        at={a !== null ? { x: labelW + ac * (cellW + gap) + cellW / 2, y: top + ar * (cellH + gap) } : null}
        content={a !== null ? { heading: `${rows[ar]} kl. ${cols[ac]}`, rows: [{ label: 'Beläggning', value: avalue }] } : null}
      />
      <figcaption className="sk-legend sk-heat-legend">
        <span className="sk-heat-legend-label">Beläggning</span>
        {['0-19', '20-39', '40-59', '60-79', '80-100'].map((label, i) => (
          <span key={label}>
            <i className={`sk-swatch sk-heat-cell--${i}`} aria-hidden="true" />
            {label}&nbsp;%
          </span>
        ))}
      </figcaption>
      <ChartTable caption={ariaLabel} head={tableHead} rows={tableRows} />
    </figure>
  )
}

/* --- Gnistlinjen i nyckeltalen ----------------------------------------------- */

/** En liten linje över perioden; varje dag visar sitt värde i verktygstipset. */
export function Sparkline({ points, format, label }: { points: { label: string; value: number }[]; format: (v: number) => string; label: string }) {
  const tip = useChartTip(points.length)
  if (points.length < 2 || points.every((p) => p.value === 0)) return null
  const w = 96
  const h = 24
  const max = Math.max(...points.map((p) => p.value), 1)
  const step = w / (points.length - 1)
  const px = (i: number) => i * step
  const py = (v: number) => h - 2 - (v / max) * (h - 4)
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ')
  const a = tip.active
  const ap = a !== null ? points[a] : null
  return (
    <span className="sk-spark-wrap chart-tip-host">
      <svg
        className="sk-spark chart-tip-surface"
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label={`${label} per dag`}
        {...tip.surface}
      >
        <path d={d} />
        {ap && <circle cx={px(a!)} cy={py(ap.value)} r={2.5} className="sk-spark-dot" />}
        {points.map((_p, i) => (
          <rect key={i} x={px(i) - step / 2} y={-4} width={step} height={h + 8} className="chart-hit" {...tip.hit(i)} />
        ))}
      </svg>
      <ChartTip tip={tip} at={ap ? { x: px(a!), y: py(ap.value) - 3 } : null} content={ap ? { heading: ap.label, rows: [{ label, value: format(ap.value) }] } : null} />
    </span>
  )
}
