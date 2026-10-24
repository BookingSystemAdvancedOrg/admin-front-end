import { useRef } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Num } from './Num'
import { useLiquidFill } from './useLiquidFill'
import { useMotionAllowed } from './MotionScope'
import { TrendBadge } from '../TrendBadge'
import { useTrendPop } from './useTrendPop'
import { toneClass } from '../trend'
import type { Trend } from '../trend'

const STAGGER_MS = 140

export interface StatTileProps {
  label: string
  /** Färdigformaterat värde ("12", "1 250 kr", "-"). Räknas upp när det kommer. */
  value: string
  note?: ReactNode
  /** Länktext längst ned; med `to` blir hela rutan en länk. */
  action?: string
  to?: string
  onClick?: () => void
  tone?: 'attention'
  /** Datan är inte här än: rutan står tom och väntar. */
  loading?: boolean
  /** Ordningsnummer i raden: varje ruta börjar lite efter den förra. */
  index?: number
  /** Hur det går mot jämförelsen (shared/trend): talet blir grönt eller rött och förändringen står uppe till höger. */
  trend?: Trend
  className?: string
}

/**
 * Nyckeltalsruta som fylls med vätska när siffran kommer (samma vatten som
 * Översikt): strålen häller i från ovan, ytan gungar och siffran räknas upp
 * exponentiellt till det riktiga värdet. Pekaren rör vid ytan. Texten
 * ligger alltid ovanpå. Bara första gången sidan visas i fliken
 * (MotionScope); sedan, och med "minska rörelse", visas slutläget direkt.
 */
export function StatTile({
  label,
  value,
  note,
  action,
  to,
  onClick,
  tone,
  loading = false,
  index = 0,
  trend,
  className = '',
}: StatTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tileRef = useRef<HTMLElement>(null)
  const allowed = useMotionAllowed()
  const trendTone = !loading && trend ? trend.tone : 'neutral'
  // Lyser upp när talet nästan landat och blivit grönt.
  const valueRef = useTrendPop<HTMLParagraphElement>(trendTone, index * STAGGER_MS + 700)
  const liquid = useLiquidFill(tileRef, canvasRef, { active: !loading, enabled: allowed, index, staggerMs: STAGGER_MS, reveal: true })

  const touch = (e: PointerEvent<HTMLElement>, force: number) => {
    const tile = tileRef.current
    if (!tile) return
    const rect = tile.getBoundingClientRect()
    liquid.touch((e.clientX - rect.left) / rect.width, force)
  }
  const handlers = {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => touch(e, 3.5),
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (Math.random() < 0.25) touch(e, 0.35)
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => touch(e, -2),
  }
  const classes = `admin-card stat-tile${to || onClick ? ' stat-tile--link' : ''}${tone ? ` stat-tile--${tone}` : ''} ${className}`
  const body = (
    <>
      <canvas ref={canvasRef} className="stat-tile-liquid" aria-hidden="true" />
      <p className="stat-tile-label">
        {label}
        {trend && !loading && <TrendBadge trend={trend} className="stat-tile-delta" />}
      </p>
      <p ref={valueRef} className={`stat-tile-value${toneClass(trendTone)}`}>
        {loading ? '…' : <Num delayMs={index * STAGGER_MS}>{value}</Num>}
      </p>
      {(note || loading) && <p className="stat-tile-note">{loading ? 'Hämtar…' : note}</p>}
      {action && (
        <span className="stat-tile-action">
          {action} <span aria-hidden="true">→</span>
        </span>
      )}
    </>
  )

  if (to) {
    return (
      <Link ref={tileRef as React.RefObject<HTMLAnchorElement>} to={to} className={classes} {...handlers}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button ref={tileRef as React.RefObject<HTMLButtonElement>} type="button" className={classes} onClick={onClick} {...handlers}>
        {body}
      </button>
    )
  }
  return (
    <div ref={tileRef as React.RefObject<HTMLDivElement>} className={classes} {...handlers}>
      {body}
    </div>
  )
}
