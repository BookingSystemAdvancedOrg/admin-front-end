import type { Order } from '../../features/bestallningar/ordersApi'
import type { RequestSummary } from '../../features/catering/cateringApi'

/**
 * Larmet för nya onlinebeställningar, utan React och utan ljud: vad är nytt
 * och vad står i rutan (store.ts håller tillståndet, OrderAlert.tsx ritar).
 *
 * Ny = ett id som den här fliken inte har sett förut och som fortfarande
 * väntar på personalen (confirmed). Regler:
 * - Första listan för en plats är facit och larmar aldrig (inloggning, ny
 *   flik, platsbyte).
 * - Sedda id:n glöms inte under sessionen, så ett gammalt svar som kommer
 *   efter ett nyare, en återanslutning eller ett sidbesök larmar inte igen:
 *   varje beställning larmar en gång.
 * - En beställning som en kollega redan har påbörjat (eller avbrutit) när
 *   fliken ser den första gången larmar inte. Efter en stund utan nät larmar
 *   alltså bara de som fortfarande ligger under Nya.
 * - Samma regler för cateringförfrågningar (egen lista och egna sedda id:n per
 *   slag): ny = status requested utan reviewedAt, alltså en gästs förfrågan som
 *   ingen i personalen har rört. Redan granskade, besvarade eller ändrade
 *   (change_requested, samma id) larmar inte.
 * - Nya läggs överst i den öppna rutan, aldrig två gånger. OK tömmer rutan;
 *   nästa nya öppnar en ny ruta.
 */

/** Hur många sedda id:n som sparas (de äldsta faller bort först). */
export const MAX_SEEN = 2000
/** En omladdning i samma flik fortsätter där den var, om den sparades nyss. */
export const RESTORE_MS = 10 * 60_000

export interface AlertState<T = Order> {
  /** Platsen som id:na gäller (null = ingen lista än). */
  locationId: string | null
  /** Id:n som fliken har sett, äldst först. */
  seen: readonly string[]
  /** Rutans beställningar, nyaste först. Tom = rutan är stängd. */
  open: readonly T[]
  /** Efter en omladdning: id:n som ska tillbaka i rutan (utan ljud) när listan kommer. */
  restore: readonly string[]
}

export const EMPTY_ALERT: AlertState<never> = { locationId: null, seen: [], open: [], restore: [] }

/** Senast betald först; samma minut: högst nummer först. */
export function newestFirst(a: Order, b: Order): number {
  const at = (o: Order) => o.confirmedAt ?? o.createdAt ?? ''
  if (at(a) !== at(b)) return at(a) < at(b) ? 1 : -1
  return (b.number ?? 0) - (a.number ?? 0)
}

function cap(ids: string[]): string[] {
  return ids.length > MAX_SEEN ? ids.slice(ids.length - MAX_SEEN) : ids
}

/** Vad som skiljer ett slag (beställning, cateringförfrågan) åt: id, vad som är nytt och ordningen. */
export interface AlertKind<T> {
  id: (item: T) => string
  /** Ska ett första-gången-sett objekt larma? */
  isNew: (item: T) => boolean
  /** Nyaste först. */
  order: (a: T, b: T) => number
}

export const ORDER_KIND: AlertKind<Order> = {
  id: (o) => o.orderId,
  isNew: (o) => o.status === 'confirmed',
  order: newestFirst,
}

/** Senast inkommen först. */
export function newestRequestFirst(a: RequestSummary, b: RequestSummary): number {
  if ((a.createdAt ?? '') !== (b.createdAt ?? '')) return (a.createdAt ?? '') < (b.createdAt ?? '') ? 1 : -1
  return b.requestId.localeCompare(a.requestId)
}

export const CATERING_KIND: AlertKind<RequestSummary> = {
  id: (r) => r.requestId,
  isNew: (r) => r.status === 'requested' && !r.reviewedAt,
  order: newestRequestFirst,
}

/**
 * En ny lista (dagens beställningar, eller cateringförfrågningarna, för
 * platsen). Returnerar det nya tillståndet och det som ska larma nu (tom =
 * inget ljud).
 */
export function observeKind<T>(
  kind: AlertKind<T>,
  state: AlertState<T>,
  locationId: string,
  items: readonly T[],
): { state: AlertState<T>; added: T[] } {
  if (state.locationId !== locationId) {
    return {
      state: { locationId, seen: cap(items.map(kind.id)), open: [], restore: [] },
      added: [],
    }
  }
  const seen = new Set(state.seen)
  const nextSeen = [...state.seen]
  const added: T[] = []
  for (const o of items) {
    const id = kind.id(o)
    if (seen.has(id)) continue
    seen.add(id)
    nextSeen.push(id)
    if (kind.isNew(o)) added.push(o)
  }
  const inBox = new Set(state.open.map(kind.id))
  const byId = new Map(items.map((o) => [kind.id(o), o]))
  const restored = state.restore
    .map((id) => byId.get(id))
    .filter((o): o is T => o !== undefined && !inBox.has(kind.id(o)))
  const fresh = added.filter((o) => !inBox.has(kind.id(o))).sort(kind.order)
  if (!fresh.length && !restored.length && !state.restore.length && nextSeen.length === state.seen.length) {
    return { state, added: [] }
  }
  return {
    state: {
      locationId,
      seen: cap(nextSeen),
      open: [...fresh, ...state.open, ...restored.sort(kind.order)],
      restore: [],
    },
    added: fresh,
  }
}

export function observe(
  state: AlertState,
  locationId: string,
  orders: readonly Order[],
): { state: AlertState; added: Order[] } {
  return observeKind(ORDER_KIND, state, locationId, orders)
}

/** OK: rutan stängs och listan töms. Sedda id:n står kvar. */
export function acknowledge<T>(state: AlertState<T>): AlertState<T> {
  if (!state.open.length && !state.restore.length) return state
  return { ...state, open: [], restore: [] }
}

type Stored = { v: 1; loc: string; seen: string[]; open: string[]; at: number }

/** Det som sparas i fliken: bara id:n, inga namn eller belopp. */
export function toStored<T = Order>(
  state: AlertState<T>,
  now: number,
  idOf: (item: T) => string = (item) => (item as Order).orderId,
): string | null {
  if (!state.locationId) return null
  const stored: Stored = {
    v: 1,
    loc: state.locationId,
    seen: [...state.seen],
    open: [...state.open.map(idOf), ...state.restore],
    at: now,
  }
  return JSON.stringify(stored)
}

/** Tillståndet efter en omladdning, eller ett tomt (gammalt, trasigt, saknas). */
export function fromStored<T = Order>(raw: string | null, now: number): AlertState<T> {
  if (!raw) return EMPTY_ALERT
  try {
    const s = JSON.parse(raw) as Partial<Stored>
    const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : null)
    const seen = ids(s.seen)
    const open = ids(s.open)
    if (s.v !== 1 || typeof s.loc !== 'string' || !s.loc || !seen || !open || typeof s.at !== 'number') return EMPTY_ALERT
    if (now - s.at > RESTORE_MS || s.at - now > 60_000) return EMPTY_ALERT
    return { locationId: s.loc, seen: cap(seen), open: [], restore: open }
  } catch {
    return EMPTY_ALERT
  }
}

/** "Burgarmeny, 2 × Toast Skagen, Lemonad +2": de tre första raderna och hur många till. */
export function orderSummary(order: Pick<Order, 'lines'>, max = 3): string {
  const lines = order.lines ?? []
  const shown = lines.slice(0, max).map((l) => (l.quantity > 1 ? `${l.quantity} × ${l.name}` : l.name))
  const rest = lines.length - shown.length
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ')
}
