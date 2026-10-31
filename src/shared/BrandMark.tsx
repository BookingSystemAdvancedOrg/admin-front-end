/**
 * Booqys logotyp, ritad som geometri efter originalen.
 *
 * Två former: ordmärket "booqy" (tunna, rundade linjer, för ytor där hela
 * namnet får plats) och b-märket (det vita b:et på vinröd botten, för små
 * ytor som ikoner och brickor där namnet inte får plats). Samma teckning som
 * Booqy Console. Flikikonen (assets/favicon.svg) är bara b:et, utan botten.
 */

export const BRAND_RED = '#350001'

/** b-märket, nonzero-fyllning i en 2000-ruta. */
export const MARK_PATH =
  'M620.5 937.5A379.5 379.5 0 1 1 1379.5 937.5A379.5 379.5 0 1 1 620.5 937.5Z' +
  'M727 937.5A273 286.5 0 1 0 1273 937.5A273 286.5 0 1 0 727 937.5Z' +
  'M620 368A55 55 0 0 1 730 368V937.5H620Z' +
  'M814 937.5A186 163.5 0 0 1 1186 937.5Z' +
  'M729.2 972H1270.8L1257.2 1029H742.8Z'

/** Ikonrutan: märket centrerat i en 1400-kvadrat av 2000-rutan. */
const ICON = { x: 300, y: 115, s: 1400 }

/**
 * b-märket. `tone="red"` (standard) är den vinröda brickan med vitt b,
 * `tone="mono"` bara b:et i currentColor (på egen färgad botten).
 * Dekorativt om ingen `title` ges; namnet står då bredvid.
 */
export function BrandMark({
  size = 34,
  tone = 'red',
  rounded = true,
  title,
}: {
  size?: number
  tone?: 'red' | 'mono'
  rounded?: boolean
  title?: string
}) {
  const aria = title ? { role: 'img' } : { 'aria-hidden': true as const }
  return (
    <svg width={size} height={size} viewBox={`${ICON.x} ${ICON.y} ${ICON.s} ${ICON.s}`} focusable="false" {...aria}>
      {title && <title>{title}</title>}
      {tone === 'red' && (
        <rect x={ICON.x} y={ICON.y} width={ICON.s} height={ICON.s} rx={rounded ? Math.round(ICON.s * 0.22) : 0} fill={BRAND_RED} />
      )}
      <path d={MARK_PATH} fill={tone === 'red' ? '#fff' : 'currentColor'} />
    </svg>
  )
}

/** Ordmärkets ruta (500-rutan beskuren till teckningen); bredd/höjd 2,31. */
export const WORDMARK_VIEWBOX = '52 191 416 180'
export const WORDMARK_RATIO = 416 / 180

/**
 * Ordmärket "booqy" i currentColor: fyra ringar, b:ets stapel och
 * halvskiva, q:ets stapel och y:ets två ben, alla med runda ändar.
 */
export function BrandWordmark({ height = 18, title, className }: { height?: number; title?: string; className?: string }) {
  const aria = title ? { role: 'img' } : { 'aria-hidden': true as const }
  return (
    <svg
      className={className ? `brand-wordmark ${className}` : 'brand-wordmark'}
      height={height}
      width={Math.round(height * WORDMARK_RATIO)}
      viewBox={WORDMARK_VIEWBOX}
      focusable="false"
      {...aria}
    >
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeWidth={14} strokeLinecap="round">
        <circle cx={104.5} cy={281.5} r={35.5} />
        <circle cx={186} cy={281.5} r={35.5} />
        <circle cx={265.5} cy={281.5} r={35.5} />
        <circle cx={345} cy={281.5} r={35.5} />
        <path d="M66.5 205.5V311.5" />
        <path d="M379 281.5V351" />
        <path d="M387 240 424 315" />
        <path d="M453 238 405 356" />
      </g>
      <g fill="currentColor">
        <path d="M84 280.5A20.5 20.5 0 0 1 125 280.5Z" />
        <rect x={79.5} y={282.5} width={50} height={5} />
      </g>
    </svg>
  )
}
