import type { ReactNode } from 'react'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Num } from '../../shared/motion/Num'
import { useTrendPop } from '../../shared/motion/useTrendPop'
import { toneClass } from '../../shared/trend'
import type { Trend } from '../../shared/trend'
import { Delta, Sparkline } from './charts'
import { helpSlug } from '../../shared/helpId'

/**
 * Byggstenarna på Statistik: nyckeltalsrutan, kortet med rubrik och
 * förklaring (i) och raden "Gör så här". Varje siffra har en förklaring på
 * en rad i klartext, så att ingen behöver gissa vad den räknar.
 */

export function Tile({
  label,
  value,
  sub,
  info,
  trend,
  against,
  spark,
  tone,
}: {
  label: string
  value: string
  sub?: string
  /** Vad siffran räknar, en rad i klartext. */
  info?: string
  /** Mot jämförelsen (shared/trend); null = ingen förra period, utelämnad = ingen jämförelse vald. */
  trend?: Trend | null
  against?: string
  spark?: { points: { label: string; value: number }[]; format: (v: number) => string }
  tone?: 'warn' | 'bad'
}) {
  // En egen varningsfärg (t.ex. många uteblivna) går före tonen mot förra perioden.
  const trendTone = !tone && trend ? trend.tone : 'neutral'
  const valueRef = useTrendPop<HTMLElement>(trendTone, 700)
  return (
    <div className={`admin-card sk-kpi${tone ? ` sk-kpi--${tone}` : ''}`} data-help={`kpi:${helpSlug(label)}`}>
      <span className="sk-kpi-head">
        <span className="sk-kpi-label">{label}</span>
        {info && <InfoTooltip label={label}>{info}</InfoTooltip>}
      </span>
      <strong ref={valueRef} className={`sk-kpi-value${toneClass(trendTone)}`}>
        <Num>{value}</Num>
      </strong>
      {spark && <Sparkline points={spark.points} format={spark.format} label={label} />}
      {sub && <span className="sk-kpi-sub">{sub}</span>}
      {trend !== undefined && <Delta trend={trend}>mot {against}</Delta>}
    </div>
  )
}

/** "Gör så här": vad siffran betyder för den som driver restaurangen. */
export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="sk-tip">
      <span className="sk-tip-label">Gör så här</span> {children}
    </p>
  )
}

export function Card({
  title,
  label,
  info,
  children,
  wide,
}: {
  title: string
  label: string
  /** Vad kortet räknar, en rad i klartext (i-knappen vid rubriken). */
  info?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <section className={`admin-card${wide ? ' sk-wide' : ''}`} aria-label={label} data-help={`card:${helpSlug(label)}`}>
      <div className="sk-card-head">
        <h3 className="card-title">{title}</h3>
        {info && <InfoTooltip label={label}>{info}</InfoTooltip>}
      </div>
      {children}
    </section>
  )
}
