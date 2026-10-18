import { useEffect, useMemo, useState } from 'react'
import { ApiError, apiFetch } from './api'

/**
 * Bordens namn och platser i den GÄLLANDE publicerade planritningen
 * (GET /locations/{id}/layout/active - samma som gästerna bokar mot).
 *
 * Numreringen är exakt densamma som bokningssajtens (customer-front-end
 * shared/layoutApi.ts: våningar i nivåordning, borden i ritningens ordning,
 * numrerade 1, 2, 3 … över alla våningar) så personal och gäster säger
 * samma "Bord 3" om samma bord. Har ett bord en egen etikett används den.
 * Bordens id i API:t är långa uuid:n - de visas aldrig.
 */

export interface TableInfo {
  tableId: string
  label: string
  seats: number
}

interface PublicLayoutElement {
  elementId: string
  type: string
  floorId?: string
  seats?: number
  label?: string
}

interface PublicLayout {
  floors: { floorId: string; level: number }[]
  elements: PublicLayoutElement[]
}

export function tablesFromLayout(layout: PublicLayout): TableInfo[] {
  const groups =
    layout.floors.length === 0
      ? [layout.elements]
      : [...layout.floors]
          .sort((a, b) => a.level - b.level)
          .map((floor) => layout.elements.filter((el) => el.floorId === floor.floorId))
  return groups
    .flatMap((elements) => elements.filter((el) => el.type === 'table'))
    .map((el, i) => ({
      tableId: el.elementId,
      label: el.label?.trim() || String(i + 1),
      seats: Number(el.seats) || 0,
    }))
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; promise: Promise<TableInfo[]> }>()

/** Platsens bord; ingen publicerad planritning = inga bord. Cachas en minut. */
export function loadTables(locationId: string, now: number = Date.now()): Promise<TableInfo[]> {
  const hit = cache.get(locationId)
  if (hit && now - hit.at < TTL_MS) return hit.promise
  const promise = apiFetch<PublicLayout>(
    `/locations/${encodeURIComponent(locationId)}/layout/active`,
  )
    .then(tablesFromLayout)
    .catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return []
      cache.delete(locationId)
      throw err
    })
  cache.set(locationId, { at: now, promise })
  return promise
}

export function clearTablesCache(): void {
  cache.clear()
}

export interface TablesState {
  /** null = inte hämtade (än) eller gick inte att hämta. */
  tables: TableInfo[] | null
  labels: Map<string, string> | null
  error: boolean
}

export function useTables(locationId: string | null | undefined): TablesState {
  const [state, setState] = useState<{ key: string | null; tables: TableInfo[] | null; error: boolean }>({
    key: null,
    tables: null,
    error: false,
  })

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    loadTables(locationId).then(
      (tables) => !cancelled && setState({ key: locationId, tables, error: false }),
      () => !cancelled && setState({ key: locationId, tables: null, error: true }),
    )
    return () => {
      cancelled = true
    }
  }, [locationId])

  const tables = state.key === locationId ? state.tables : null
  const labels = useMemo(
    () => (tables ? new Map(tables.map((t) => [t.tableId, t.label])) : null),
    [tables],
  )
  return { tables, labels, error: state.key === locationId && state.error }
}

/**
 * "Bord 1, 3". Med kända etiketter visas de (ett bord som inte finns i den
 * gällande ritningen - en äldre bokning - blir "?"); går ritningen inte att
 * hämta visas id:na som de är.
 */
export function tableNames(ids: string[], labels: Map<string, string> | null): string {
  if (ids.length === 0) return '-'
  if (!labels) return `Bord ${ids.join(', ')}`
  return `Bord ${ids.map((id) => labels.get(id) ?? '?').join(', ')}`
}
