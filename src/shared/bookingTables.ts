import { useCallback, useEffect, useState } from 'react'
import { loadVersionPlans } from '../features/layout-editor/activeLayout'
import { bookingLabels, useTables, type BookedTables } from './tables'

/**
 * Bokningarnas bordsnamn i den planritningsversion som gäller deras tid
 * (samma som mejlet och gästens bokningssida). Nya bokningar bär sina namn
 * (tableLabels); en äldre bokning vars bord inte står i dagens ritning slås
 * upp i sin version (GET /layout/versions, bara när det behövs, en minut).
 */

type VersionLabels = Map<number, Map<string, string>>

const TTL_MS = 60_000
const cache = new Map<string, { at: number; promise: Promise<VersionLabels> }>()

function loadVersionLabels(locationId: string, now: number = Date.now()): Promise<VersionLabels> {
  const hit = cache.get(locationId)
  if (hit && now - hit.at < TTL_MS) return hit.promise
  const promise = loadVersionPlans(locationId).then(
    (vp) => new Map([...vp.plans].map(([v, plan]) => [v, plan.labels])),
    // Utan versionerna gäller dagens ritning; bord som saknas där blir "Borttaget bord".
    () => {
      cache.delete(locationId)
      return new Map() as VersionLabels
    },
  )
  cache.set(locationId, { at: now, promise })
  return promise
}

export function clearVersionLabelsCache(): void {
  cache.clear()
}

export function useBookingLabels(
  locationId: string | null | undefined,
  bookings: BookedTables[],
): { labels: Map<string, string> | null; labelsFor: (b: BookedTables) => Map<string, string> | null } {
  const { labels } = useTables(locationId)
  const [versions, setVersions] = useState<{ loc: string; labels: VersionLabels } | null>(null)
  const need =
    Boolean(locationId) &&
    labels !== null &&
    bookings.some((b) => b.layoutVersion !== undefined && !b.tableIds.every((id) => bookingLabels(b, labels)?.has(id)))

  useEffect(() => {
    if (!need || !locationId) return
    let cancelled = false
    void loadVersionLabels(locationId).then((v) => !cancelled && setVersions({ loc: locationId, labels: v }))
    return () => {
      cancelled = true
    }
  }, [need, locationId])

  const byVersion = versions && versions.loc === locationId ? versions.labels : null
  const labelsFor = useCallback((b: BookedTables) => bookingLabels(b, labels, byVersion), [labels, byVersion])
  return { labels, labelsFor }
}
