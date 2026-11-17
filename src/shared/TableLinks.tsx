import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { orderTable, removedSuffix, tableNames, tableTitle } from './tables'

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
 * gällande ritningen blir "borttaget bord".
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
  if (known.length < ids.length) {
    if (known.length === 0) return <>{tableNames(ids, labels)}</>
    return (
      <>
        <TableLinks ids={known} labels={labels} date={date} />
        {removedSuffix(ids.length - known.length)}
      </>
    )
  }
  const text = `Bord ${joined(known.map((id) => labels.get(id)!))}`
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

/**
 * En bordsbeställnings bord som en knapp: "Bord 3" med samma nummer som i
 * Layout. Ett tryck öppnar bordskartan för beställningens dag med bordet
 * markerat, så personalen ser vart maten ska. Utan bord i ritningen står
 * namnet som text.
 */
export function OrderTableLink({
  tableId,
  tableLabel,
  labels,
  date,
  className,
  iconSize = 16,
}: {
  tableId?: string
  tableLabel?: string
  labels: Map<string, string> | null
  date?: string
  className?: string
  iconSize?: number
}) {
  const table = orderTable(tableId, tableLabel, labels)
  const text = tableTitle(table.label)
  if (!table.id) return <span className={className}>{text}</span>
  return (
    <Link
      className={`table-chip-link${className ? ` ${className}` : ''}`}
      to={tableHref(table.id, date)}
      aria-label={`${text}, visa i bordskartan`}
      title="Visa i bordskartan"
      onClick={(e) => e.stopPropagation()}
    >
      <Icon name="table-round" size={iconSize} />
      <span>{text}</span>
    </Link>
  )
}
