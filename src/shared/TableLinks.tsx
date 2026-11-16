import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { tableNames } from './tables'

/** Adressen till bordskartan med ett bord markerat (Layout, "Boka bord"). */
export function tableHref(tableId: string, date?: string): string {
  const q = new URLSearchParams({ bord: tableId })
  if (date) q.set('datum', date)
  return `/layout?${q.toString()}`
}

/**
 * "Bord 3, 4" där varje nummer leder till bordskartan med bordet markerat.
 * Numren är desamma som gästerna ser (shared/tables.ts); bordens id visas
 * aldrig. Innan namnen hämtats står "Ett bord"; ett bord som inte finns i
 * den gällande ritningen blir "?" utan länk.
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
  return (
    <span className="table-links">
      Bord{' '}
      {ids.map((id, i) => {
        const label = labels.get(id)
        return (
          <Fragment key={id}>
            {i > 0 ? ', ' : null}
            {label ? (
              <Link
                className="table-link"
                to={tableHref(id, date)}
                aria-label={`Bord ${label}, visa i bordskartan`}
                onClick={(e) => e.stopPropagation()}
              >
                {label}
              </Link>
            ) : (
              '?'
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
