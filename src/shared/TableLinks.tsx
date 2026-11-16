import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { tableNames } from './tables'

/** Adressen till bordskartan med bokningens bord markerade (Layout, "Boka bord"). */
export function tableHref(tableIds: string | string[], date?: string): string {
  const ids = Array.isArray(tableIds) ? tableIds : [tableIds]
  const q = new URLSearchParams({ bord: ids.join(',') })
  if (date) q.set('datum', date)
  return `/layout?${q.toString()}`
}

/** "3", "3 + 4", "3, 4 + 7": bordens nummer så som gästerna ser dem. */
function joined(labels: string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} + ${labels[labels.length - 1]}`
}

/**
 * Bokningens bord som en knapp: "Bord 3" eller "Bord 3 + 4". Ett tryck
 * öppnar bordskartan med alla bokningens bord markerade. Numren är desamma
 * som gästerna ser (shared/tables.ts); bordens id visas aldrig. Innan
 * namnen hämtats står "Ett bord" utan knapp; ett bord som inte finns i den
 * gällande ritningen blir "?".
 */
export function TableLinks({
  ids,
  labels,
  date,
}: {
  ids: string[]
  labels: Map<string, string> | null
  date?: string
}) {
  if (ids.length === 0) return <>-</>
  if (!labels) return <>{tableNames(ids, null)}</>
  const known = ids.filter((id) => labels.has(id))
  const names = ids.map((id) => labels.get(id) ?? '?')
  const text = `Bord ${joined(names)}`
  if (known.length === 0) return <>{text}</>
  const spoken = known.length === 1 ? `Bord ${labels.get(known[0])}` : `Bord ${joined(known.map((id) => labels.get(id)!)).replace(' + ', ' och ')}`
  return (
    <Link
      className="table-chip-link"
      to={tableHref(known, date)}
      aria-label={`${spoken}, visa i bordskartan`}
      title="Visa i bordskartan"
      onClick={(e) => e.stopPropagation()}
    >
      <Icon name={known.length > 1 ? 'table-square' : 'table-round'} size={14} />
      <span>{text}</span>
    </Link>
  )
}
