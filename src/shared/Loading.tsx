import './loading.css'

/**
 * Laddningsindikatorn: en orderlapp som skrivs. Ett kvitto matas ut ur
 * springan och raderna skrivs en i taget, om och om igen, tills datan är
 * här. Samma material som resten av märket (termopapper, tryckt svart).
 *
 * `inline` är en liten variant för textrader ("Hämtar…" i ett kort-huvud),
 * `block` (standard) står på egen rad i ett kort, `screen` fyller sidan.
 */
export function Loading({
  label = 'Hämtar',
  variant = 'block',
}: {
  label?: string
  variant?: 'inline' | 'block' | 'screen'
}) {
  const text = label.endsWith('…') ? label : `${label}…`
  return (
    <span className={`loading loading--${variant}`} role="status" aria-live="polite">
      <span className="loading-printer" aria-hidden="true">
        <span className="loading-slot" />
        <span className="loading-slip">
          <span className="loading-line loading-line--head" />
          <span className="loading-line" />
          <span className="loading-line loading-line--short" />
          <span className="loading-line" />
          <span className="loading-line loading-line--sum" />
        </span>
      </span>
      <span className="loading-label">{text}</span>
    </span>
  )
}
