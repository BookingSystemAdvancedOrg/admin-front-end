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

/** Ett bord som inte längre finns i den gällande ritningen och saknar sparat namn. */
export const REMOVED_TABLE = 'Borttaget bord'

/**
 * "Bord 1, 3". Med kända etiketter visas de; bord som inte finns i den
 * gällande ritningen (en äldre bokning) blir "Borttaget bord" ("Bord 1,
 * borttaget bord" när bara några är borta). Går ritningen inte att hämta
 * står antalet.
 */
export function tableNames(ids: string[], labels: Map<string, string> | null): string {
  if (ids.length === 0) return '-'
  if (!labels) return ids.length === 1 ? 'Ett bord' : `${ids.length} bord`
  const known = ids.filter((id) => labels.has(id)).map((id) => labels.get(id)!)
  const removed = ids.length - known.length
  if (known.length === 0) return removed === 1 ? REMOVED_TABLE : `${removed} borttagna bord`
  return `${tablesText(known)}${removedSuffix(removed)}`
}

/** Ett nummer ("3") eller ett okänt bord ("?") får ordet Bord framför sig; ett eget namn ("Bar") inte. */
const numbered = (label: string) => /^\d/.test(label) || label === '?'

/**
 * Flera bord: ordet en gång, sedan numren och de egna namnen som de heter:
 * "Bord 3, 4", "Bord 3, Bar", "Bar". `join` sätter ihop delarna (", " som
 * standard; TableLinks skriver "3, 4 + 7").
 */
export function tablesText(labels: string[], join: (parts: string[]) => string = (p) => p.join(', ')): string {
  const numbers = labels.filter(numbered)
  const own = labels.filter((l) => !numbered(l))
  return join(numbers.length > 0 ? [`Bord ${join(numbers)}`, ...own] : own)
}

/** ", borttaget bord" efter de bord som finns kvar ("" när inget är borta). */
export function removedSuffix(removed: number): string {
  if (removed <= 0) return ''
  return removed === 1 ? ', borttaget bord' : `, ${removed} borttagna bord`
}

/** "Bord 3"; ett bord med eget namn ("Bar") visas som det heter. */
export function tableTitle(label: string): string {
  return numbered(label) ? `Bord ${label}` : label
}

/** Det en bokning behöver för att namnge sina bord. */
export interface BookedTables {
  tableIds: string[]
  /** Namnen som stämplades när borden sattes, i samma ordning som tableIds. */
  tableLabels?: string[]
  /** Planritningsversionen som gäller bokningens tid. */
  layoutVersion?: number
}

/** Bokningens stämplade bordsnamn, eller null när de saknas eller inte stämmer med tableIds. */
export function stampedLabels(b: BookedTables): string[] | null {
  const l = b.tableLabels
  if (!Array.isArray(l) || l.length !== b.tableIds.length) return null
  const out = l.map((x) => (typeof x === 'string' ? x.trim() : ''))
  return out.every(Boolean) ? out : null
}

/**
 * Bokningens bordsnamn i den planritningsversion som gäller bokningens tid,
 * samma namn som mejlet till restaurangen och gästens bokningssida visar.
 * I första hand namnen som stämplades på bokningen (de kommer från bokningens
 * version, även när en annan version gäller idag), sedan bokningens version
 * när den är hämtad, sist den gällande ritningen. null = inget känt än.
 */
export function bookingLabels(
  b: BookedTables,
  active: Map<string, string> | null,
  versions: Map<number, Map<string, string>> | null = null,
): Map<string, string> | null {
  const stamped = stampedLabels(b)
  const byVersion = b.layoutVersion !== undefined ? versions?.get(b.layoutVersion) : undefined
  if (!stamped && !byVersion && !active) return null
  const out = new Map<string, string>()
  b.tableIds.forEach((id, i) => {
    const label = stamped?.[i] ?? byVersion?.get(id) ?? active?.get(id)
    if (label) out.set(id, label)
  })
  return out
}

/**
 * En äldre bordsbeställnings bord i den gällande ritningen (QR-beställning vid
 * bordet är borttagen). Bordets id i första hand (det står kvar om bordet byter nummer); saknas id:t letas bordet upp på
 * namnet. Finns bordet inte längre i ritningen blir id null och det sparade
 * namnet visas, eller "Borttaget bord" när inget namn sparades.
 */
export function orderTable(
  tableId: string | undefined,
  tableLabel: string | undefined,
  labels: Map<string, string> | null,
): { id: string | null; label: string } {
  const stored = tableLabel?.trim() || REMOVED_TABLE
  if (!labels) return { id: null, label: tableLabel?.trim() || 'Bord' }
  if (tableId) return labels.has(tableId) ? { id: tableId, label: labels.get(tableId)! } : { id: null, label: stored }
  const hits = [...labels].filter(([, label]) => label === tableLabel?.trim())
  return hits.length === 1 ? { id: hits[0][0], label: hits[0][1] } : { id: null, label: stored }
}
