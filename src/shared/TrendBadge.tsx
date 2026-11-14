import { Icon } from './Icon'
import type { Trend } from './trend'
import './trend.css'

/**
 * Förändringen bredvid ett nyckeltal: en pil, "+12 %" och, för
 * skärmläsare, hela meningen ("upp 12 % mot förra veckan"). Färgen följer
 * tonen; neutralt är vanlig text. Inget att jämföra med ger ingenting.
 * `chip` (nyckeltalsrutor): bara pil och procent, inga ord: "oförändrat"
 * blir "0 %" och "ny" (från noll) bara en pil.
 */
export function TrendBadge({ trend, label, chip = false, className = '' }: { trend: Trend; label?: string; chip?: boolean; className?: string }) {
  if (!trend.text) return null
  const fresh = trend.text === 'ny'
  const text = !chip ? trend.text : trend.direction === 'flat' ? '0\u00a0%' : fresh ? '' : trend.text
  const up = trend.direction === 'up' && (!fresh || trend.tone !== 'neutral')
  if (!text && !up) return null
  return (
    <span className={`trend trend--${trend.tone} ${className}`}>
      {up && <Icon name="trend-up" size={14} />}
      {trend.direction === 'down' && <Icon name="trend-down" size={14} />}
      {text && <span aria-hidden="true">{text}</span>}
      {label && !chip && (
        <span className="trend-label" aria-hidden="true">
          {label}
        </span>
      )}
      <span className="sr-only">{trend.spoken}</span>
    </span>
  )
}
