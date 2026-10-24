import { Icon } from './Icon'
import type { Trend } from './trend'
import './trend.css'

/**
 * Förändringen bredvid ett nyckeltal: en pil, "+12 %" och, för
 * skärmläsare, hela meningen ("upp 12 % mot förra veckan"). Färgen följer
 * tonen; neutralt är vanlig text. Inget att jämföra med ger ingenting.
 */
export function TrendBadge({ trend, label, className = '' }: { trend: Trend; label?: string; className?: string }) {
  if (!trend.text) return null
  return (
    <span className={`trend trend--${trend.tone} ${className}`}>
      {trend.direction === 'up' && trend.text !== 'ny' && <Icon name="trend-up" size={14} />}
      {trend.direction === 'down' && <Icon name="trend-down" size={14} />}
      <span aria-hidden="true">{trend.text}</span>
      {label && (
        <span className="trend-label" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="sr-only">{trend.spoken}</span>
    </span>
  )
}
