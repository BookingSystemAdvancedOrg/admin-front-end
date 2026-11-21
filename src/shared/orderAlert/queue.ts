import type { Order } from '../../features/bestallningar/ordersApi'

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
 * - Nya läggs överst i den öppna rutan, aldrig två gånger. OK tömmer rutan;
 *   nästa nya öppnar en ny ruta.
 */

/** Hur många sedda id:n som sparas (de äldsta faller bort först). */
export const MAX_SEEN = 2000
/** En omladdning i samma flik fortsätter där den var, om den sparades nyss. */
export const RESTORE_MS = 10 * 60_000

export interface AlertState {
  /** Platsen som id:na gäller (null = ingen lista än). */
  locationId: string | null
  /** Id:n som fliken har sett, äldst först. */
  seen: readonly string[]
  /** Rutans beställningar, nyaste först. Tom = rutan är stängd. */
  open: readonly Order[]
  /** Efter en omladdning: id:n som ska tillbaka i rutan (utan ljud) när listan kommer. */
  restore: readonly string[]
}

export const EMPTY_ALERT: AlertState = { locationId: null, seen: [], open: [], restore: [] }

/** Senast betald först; samma minut: högst nummer först. */
export function newestFirst(a: Order, b: Order): number {
  const at = (o: Order) => o.confirmedAt ?? o.createdAt ?? ''
  if (at(a) !== at(b)) return at(a) < at(b) ? 1 : -1
  return (b.number ?? 0) - (a.number ?? 0)
}

function cap(ids: string[]): string[] {
  return ids.length > MAX_SEEN ? ids.slice(ids.length - MAX_SEEN) : ids
}

/**
 * En ny lista (dagens beställningar för platsen). Returnerar det nya
 * tillståndet och beställningarna som ska larma nu (tom = inget ljud).
 */
export function observe(
  state: AlertState,
  locationId: string,
  orders: readonly Order[],
): { state: AlertState; added: Order[] } {
  if (state.locationId !== locationId) {
    return {
      state: { locationId, seen: cap(orders.map((o) => o.orderId)), open: [], restore: [] },
      added: [],
    }
  }
  const seen = new Set(state.seen)
  const nextSeen = [...state.seen]
  const added: Order[] = []
  for (const o of orders) {
    if (seen.has(o.orderId)) continue
    seen.add(o.orderId)
    nextSeen.push(o.orderId)
    if (o.status === 'confirmed') added.push(o)
  }
  const inBox = new Set(state.open.map((o) => o.orderId))
  const byId = new Map(orders.map((o) => [o.orderId, o]))
  const restored = state.restore
    .map((id) => byId.get(id))
    .filter((o): o is Order => o !== undefined && !inBox.has(o.orderId))
  const fresh = added.filter((o) => !inBox.has(o.orderId)).sort(newestFirst)
  if (!fresh.length && !restored.length && !state.restore.length && nextSeen.length === state.seen.length) {
    return { state, added: [] }
  }
  return {
    state: {
      locationId,
      seen: cap(nextSeen),
      open: [...fresh, ...state.open, ...restored.sort(newestFirst)],
      restore: [],
    },
    added: fresh,
  }
}

/** OK: rutan stängs och listan töms. Sedda id:n står kvar. */
export function acknowledge(state: AlertState): AlertState {
  if (!state.open.length && !state.restore.length) return state
  return { ...state, open: [], restore: [] }
}

type Stored = { v: 1; loc: string; seen: string[]; open: string[]; at: number }

/** Det som sparas i fliken: bara id:n, inga namn eller belopp. */
export function toStored(state: AlertState, now: number): string | null {
  if (!state.locationId) return null
  const stored: Stored = {
    v: 1,
    loc: state.locationId,
    seen: [...state.seen],
    open: [...state.open.map((o) => o.orderId), ...state.restore],
    at: now,
  }
  return JSON.stringify(stored)
}

/** Tillståndet efter en omladdning, eller ett tomt (gammalt, trasigt, saknas). */
export function fromStored(raw: string | null, now: number): AlertState {
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
