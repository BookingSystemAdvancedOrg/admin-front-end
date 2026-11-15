import { ApiError } from './api'
import { sameData } from './live'

/**
 * Samtidiga ändringar utan "ladda om".
 *
 * Någon annan (en kollega, en annan plats) hann spara samma sak medan du
 * redigerade: API:t svarar 409 (changed_retry, conflict, stale_item,
 * stale_categories ...). Då hämtar appen det senaste själv, lägger dina
 * ändrade fält ovanpå och sparar en gång till. Bara om samma fält ändrats på
 * båda håll till olika värden stannar det: fältet får en lugn rad med det
 * andra värdet ("Ändrades nyss på en annan plats: 129 kr") och ditt värde
 * står kvar så du väljer.
 */

export const CONFLICT_CODES: ReadonlySet<string> = new Set([
  'changed_retry',
  'conflict',
  'stale',
  'stale_item',
  'stale_categories',
  'stale_version',
  'version_conflict',
  'version_mismatch',
])

/** Ett 409 som betyder "någon annan sparade emellan" (inte "upptaget", "finns redan"). */
export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && CONFLICT_CODES.has(err.code) && (err.status === 409 || err.status === 412)
}

export interface FieldConflict {
  field: string
  /** Ditt värde (står kvar i formuläret). */
  mine: unknown
  /** Värdet som sparades på annat håll. */
  theirs: unknown
}

/**
 * Trevägsfusion fält för fält. `base` är posten som formuläret öppnades med,
 * `mine` formulärets värden, `theirs` det senaste från servern. Fält du inte
 * ändrat tar serverns värde; fält du ändrat behåller ditt. Har servern också
 * ändrat det fältet, till något annat än ditt, blir det en konflikt.
 * `ignore` (version, updatedAt ...) tas alltid från servern.
 */
export function mergeEdits<T extends object>(
  base: T,
  mine: Partial<T>,
  theirs: T,
  ignore: readonly string[] = ['version', 'updatedAt'],
): { merged: T; conflicts: FieldConflict[] } {
  const merged = { ...theirs } as Record<string, unknown>
  const b = base as Record<string, unknown>
  const m = mine as Record<string, unknown>
  const t = theirs as Record<string, unknown>
  const conflicts: FieldConflict[] = []
  for (const field of Object.keys(m)) {
    if (ignore.includes(field)) continue
    if (sameData(m[field], b[field])) continue // inte ändrat här: serverns gäller
    merged[field] = m[field]
    if (sameData(t[field], b[field]) || sameData(t[field], m[field])) continue
    conflicts.push({ field, mine: m[field], theirs: t[field] })
  }
  return { merged: merged as T, conflicts }
}

/** De fält du ändrat jämfört med `base` (det som ska sparas). */
export function changedFields<T extends object>(base: T, mine: Partial<T>, ignore: readonly string[] = []): Partial<T> {
  const out: Record<string, unknown> = {}
  const b = base as Record<string, unknown>
  for (const [field, value] of Object.entries(mine as Record<string, unknown>)) {
    if (!ignore.includes(field) && !sameData(value, b[field])) out[field] = value
  }
  return out as Partial<T>
}

/** Fält som ändrats på servern sedan formuläret öppnades (för raden under fältet). */
export function serverChanges<T extends object>(base: T, latest: T | null | undefined, fields: readonly (keyof T & string)[]): Partial<T> {
  const out: Partial<T> = {}
  if (!latest) return out
  for (const f of fields) if (!sameData(base[f], latest[f])) out[f] = latest[f]
  return out
}

/** Sparningen stannade på fält som ändrats på båda håll. */
export class ConflictError<T = unknown> extends Error {
  conflicts: FieldConflict[]
  latest: T
  constructor(conflicts: FieldConflict[], latest: T) {
    super('Samma fält ändrades nyss på en annan plats. Välj vilket värde som ska gälla och spara igen.')
    this.name = 'ConflictError'
    this.conflicts = conflicts
    this.latest = latest
  }
}

/**
 * Spara; vid ett 409 som betyder samtidig ändring: hämta det senaste, lägg
 * dina ändrade fält ovanpå och försök en gång till. `save(values, latest)`
 * får formulärets värden första gången (latest = null) och andra gången
 * bara de fält du ändrat plus den senaste posten (lägg ändringarna ovanpå
 * den: { ...latest, ...values } för ett PUT, version/updatedAt från den).
 * Kastar ConflictError när samma fält ändrats på båda håll.
 */
export async function saveWithMerge<T extends object, R>(opts: {
  base: T
  mine: Partial<T>
  save: (values: Partial<T>, latest: T | null) => Promise<R>
  fetchLatest: () => Promise<T>
  ignore?: readonly string[]
}): Promise<R> {
  try {
    return await opts.save(opts.mine, null)
  } catch (err) {
    if (!isConflict(err)) throw err
    const latest = await opts.fetchLatest()
    const mine = changedFields(opts.base, opts.mine, opts.ignore)
    const { conflicts } = mergeEdits(opts.base, mine, latest, opts.ignore)
    if (conflicts.length) throw new ConflictError(conflicts, latest)
    return opts.save(mine, latest)
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

type Keyed = Record<string, unknown> & { id: string }

/** En lista av objekt som alla har ett eget, unikt `id` (sidor, block). */
function keyedList(v: unknown): v is Keyed[] {
  if (!Array.isArray(v)) return false
  const ids = new Set<string>()
  for (const x of v) {
    if (!isPlainObject(x) || typeof x.id !== 'string' || ids.has(x.id)) return false
    ids.add(x.id)
  }
  return true
}

/** Har listan bytt ordning på de element som finns kvar från `base`? */
function reordered(base: Keyed[], list: Keyed[]): boolean {
  const inList = new Set(list.map((x) => x.id))
  const inBase = new Set(base.map((x) => x.id))
  const a = base.map((x) => x.id).filter((id) => inList.has(id))
  const b = list.map((x) => x.id).filter((id) => inBase.has(id))
  return !sameData(a, b)
}

/**
 * Listor med id (sidor, block) läggs ihop per id: det någon lagt till finns
 * kvar, det någon tagit bort försvinner, och bara samma id ändrat på båda
 * håll kan bli en konflikt. Tog den ena bort ett element som den andra
 * ändrade blir det en konflikt (ditt val gäller). Ordningen följer den som
 * flyttat om; flyttade båda olika blir ordningen en konflikt (din gäller).
 */
function mergeById(base: Keyed[], mine: Keyed[], theirs: Keyed[], path: string): { merged: Keyed[]; conflicts: string[] } {
  const b = new Map(base.map((x) => [x.id, x]))
  const m = new Map(mine.map((x) => [x.id, x]))
  const t = new Map(theirs.map((x) => [x.id, x]))
  const conflicts: string[] = []
  const at = (i: number, rest = '') => `${path ? `${path}.` : ''}${i}${rest}`

  const mineMoved = reordered(base, mine)
  const theirsMoved = reordered(base, theirs)
  if (mineMoved && theirsMoved && reordered(mine, theirs)) conflicts.push(path)
  // Ordningen: den som flyttat om (du om båda), den andras nya element in
  // efter närmaste föregående element som finns i båda.
  const [first, second] = theirsMoved && !mineMoved ? [theirs, mine] : [mine, theirs]
  const order = first.map((x) => x.id)
  second.forEach((x, i) => {
    if (order.includes(x.id)) return
    let after = -1
    for (let j = i - 1; j >= 0 && after < 0; j -= 1) after = order.indexOf(second[j].id)
    order.splice(after + 1, 0, x.id)
  })

  const merged: Keyed[] = []
  const pending: { id: string; rest: string }[] = []
  for (const id of order) {
    const [inB, inM, inT] = [b.get(id), m.get(id), t.get(id)]
    let value: Keyed | undefined
    let rest: string[] = []
    if (inB && inM && inT) {
      const r = mergeDeep(inB, inM, inT, '')
      value = r.merged
      rest = r.conflicts
    } else if (inB && !inM && inT) {
      // du tog bort, den andra ändrade
      if (!sameData(inT, inB)) rest = ['']
    } else if (inB && inM && !inT) {
      // den andra tog bort, du ändrade
      if (!sameData(inM, inB)) {
        value = inM
        rest = ['']
      }
    } else if (!inB && inM && inT) {
      value = inM
      if (!sameData(inM, inT)) rest = ['']
    } else if (!inB) {
      value = inM ?? inT
    }
    if (value !== undefined) merged.push(value)
    for (const r of rest) pending.push({ id, rest: r })
  }
  for (const { id, rest } of pending) {
    const i = merged.findIndex((x) => x.id === id)
    // Ett borttaget element: konflikten gäller listan, på platsen det hade hos dig.
    conflicts.push(i >= 0 ? at(i, rest ? `.${rest}` : '') : path)
  }
  return { merged, conflicts }
}

/**
 * Trevägsfusion av ett helt dokument (webbplatsen, layouten): objekt fält
 * för fält; listor med id (sidor, block) per id, så det en kollega lagt
 * till eller tagit bort står kvar; andra listor element för element när de
 * är lika långa på alla tre håll (annars som ett värde). Det du inte ändrat
 * tar serverns; det bara du ändrat behåller ditt. `conflicts` är sökvägarna
 * ("pages.0.blocks.2.heading", index i `merged`) som ändrats på båda håll
 * till olika värden; där står ditt kvar i `merged`.
 */
export function mergeDeep<T>(base: T, mine: T, theirs: T, path = ''): { merged: T; conflicts: string[] } {
  if (sameData(mine, base)) return { merged: theirs, conflicts: [] }
  if (sameData(theirs, base) || sameData(theirs, mine)) return { merged: mine, conflicts: [] }
  const at = (k: string | number) => (path ? `${path}.${k}` : String(k))
  if (isPlainObject(base) && isPlainObject(mine) && isPlainObject(theirs)) {
    const merged: Record<string, unknown> = {}
    const conflicts: string[] = []
    for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const r = mergeDeep(base[k], mine[k], theirs[k], at(k))
      if (r.merged !== undefined) merged[k] = r.merged
      conflicts.push(...r.conflicts)
    }
    return { merged: merged as T, conflicts }
  }
  if (keyedList(base) && keyedList(mine) && keyedList(theirs)) {
    const r = mergeById(base, mine, theirs, path)
    return { merged: r.merged as T, conflicts: r.conflicts }
  }
  if (Array.isArray(base) && Array.isArray(mine) && Array.isArray(theirs) && base.length === mine.length && base.length === theirs.length) {
    const conflicts: string[] = []
    const merged = base.map((_, i) => {
      const r = mergeDeep(base[i], mine[i], theirs[i], at(i))
      conflicts.push(...r.conflicts)
      return r.merged
    })
    return { merged: merged as T, conflicts }
  }
  return { merged: mine, conflicts: [path] }
}
