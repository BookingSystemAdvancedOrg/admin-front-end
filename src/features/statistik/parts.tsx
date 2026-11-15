import type { ReactNode } from 'react'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { Num } from '../../shared/motion/Num'
import { useTrendPop } from '../../shared/motion/useTrendPop'
import { toneClass } from '../../shared/trend'
import type { Trend } from '../../shared/trend'
import { TrendBadge } from '../../shared/TrendBadge'
import { helpSlug } from '../../shared/helpId'

/**
 * Byggstenarna på Statistik: nyckeltalsrutan, kortet med rubrik och
 * förklaring (i) och raden "Gör så här". Varje siffra har en förklaring på
 * en rad i klartext, så att ingen behöver gissa vad den räknar.
 */

export function Tile({
  label,
  value,
  info,
  detail,
  trend,
  tone,
}: {
  label: string
  value: string
  /** Vad siffran räknar, en rad i klartext. */
  info?: string
  /** Uppdelningen bakom siffran; står i (i)-bubblan, aldrig under siffran. */
  detail?: string
  /** Mot jämförelsen (shared/trend); null = ingen förra period, utelämnad = ingen jämförelse vald. */
  trend?: Trend | null
  /** Från versus(); trendens uppläsning (trend.spoken) säger redan vad den jämförs med. */
  against?: string
  tone?: 'warn' | 'bad'
}) {
  // En egen varningsfärg (t.ex. många uteblivna) går före tonen mot förra perioden.
  const trendTone = !tone && trend ? trend.tone : 'neutral'
  const valueRef = useTrendPop<HTMLElement>(trendTone, 700)
  const tip = [info, detail && !/[.!?]$/.test(detail) ? `${detail}.` : detail].filter(Boolean).join(' ')
  // Rutan visar bara rubrik och siffra; förändringen är ett litet chip (pil och procent).
  return (
    <div className={`admin-card sk-kpi${tone ? ` sk-kpi--${tone}` : ''}`} data-help={`kpi:${helpSlug(label)}`}>
      <span className="sk-kpi-head">
        <span className="sk-kpi-label">{label}</span>
        {trend && <TrendBadge trend={trend} chip className="sk-kpi-delta" />}
        {tip && <InfoTooltip label={label}>{tip}</InfoTooltip>}
      </span>
      <strong ref={valueRef} className={`sk-kpi-value${toneClass(trendTone)}`}>
        <Num>{value}</Num>
      </strong>
    </div>
  )
}

/** "Gör så här": rådet bakom en (i) så att kortet bara visar siffrorna. */
export function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="sk-tip">
      <span className="sk-tip-label">Tips</span>
      <InfoTooltip label="Gör så här">{children}</InfoTooltip>
    </div>
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
