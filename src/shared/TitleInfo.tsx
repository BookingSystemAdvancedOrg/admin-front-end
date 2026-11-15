import type { ReactNode } from 'react'
import { InfoTooltip } from './InfoTooltip'

/**
 * Kortrubrik med förklaringen bakom en (i) i stället för en rad text under.
 * Rubriken står ensam så att sidan går att läsa med en blick.
 */
export function TitleInfo({
  title,
  info,
  level = 2,
  className = 'card-title',
}: {
  title: ReactNode
  /** Förklaringen; utelämnad = bara rubriken. */
  info?: ReactNode
  level?: 2 | 3
  className?: string
}) {
  const H = level === 3 ? 'h3' : 'h2'
  return (
    <div className="title-info">
      <H className={className}>{title}</H>
      {info ? <InfoTooltip label={typeof title === 'string' ? title : 'Förklaring'}>{info}</InfoTooltip> : null}
    </div>
  )
}
