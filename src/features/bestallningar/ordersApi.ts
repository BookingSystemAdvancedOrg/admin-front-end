import { errorText as commonError } from '../../shared/errors'
import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
import { withBusy } from '../../shared/motion/busy'

/**
 * Matbeställningar (backend manage-order, docs/ORDERS.md i application).
 *
 * Gästen beställer och betalar online (Stripe). Betalda beställningar syns
 * här som "confirmed"; personalen flyttar dem till tillagas -> klar ->
 * hämtad/serverad. "Klar" på en avhämtning skickar sms:et "klar att hämta"
 * till gästen. "Avbryt" återbetalar det som är kvar via Stripe; ägaren kan
 * också återbetala en del (eller allt) utan att avbryta ("Återbetala").
 */

export type OrderStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type OrderMode = 'pickup' | 'table'

export interface OrderLine {
  menuItemId: string
  name: string
  /** Öre, inklusive moms. */
  unitPrice: number
  quantity: number
  total: number
  vatRate: number
  /** Gästens tillval med pristillägg (öre per styck, ingår i unitPrice). */
  options?: { group: string; choice: string; price: number }[]
  /** Gästens önskemål på raden ("ingen lök"); följer rätten till bongen. */
  note?: string
  /** Allergi på raden ("jordnötsallergi"): fet på bongen, egen allergibong. */
  allergy?: string
}

export interface Order {
  orderId: string
  locationId: string
  number?: number
  status: OrderStatus
  paymentStatus?: 'processing' | 'paid' | 'failed' | 'partly_refunded' | 'refunded'
  mode: OrderMode
  /** Bordets id i planritningen (QR-koden); står kvar om bordet byter namn. */
  tableId?: string
  /** Bordets namn när gästen beställde. */
  tableLabel?: string
  /** Serveringsdagen i platsens tidszon (YYYY-MM-DD). */
  date?: string
  lines: OrderLine[]
  /** Öre. */
  totalAmount: number
  /** Välkomsterbjudandets kod (raderna är redan rabatterade). */
  discount?: { code: string; percent: number; amount: number }
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  notes?: string
  createdAt?: string
  confirmedAt?: string
  readyEstimate?: string
  readyAt?: string
  completedAt?: string
  cancelledAt?: string
  /** Kortdelen som är återbetald (öre), en rad per återbetalning. */
  refund?: { amount: number; at?: string; items?: { amount: number; at?: string; reason?: string }[] }
  /** Vad ägaren fortfarande kan återbetala av kortdelen (öre). */
  refundable?: number
  /** Presentkortets del; den kommer bara tillbaka om beställningen avbryts. */
  giftCard?: { last4?: string; debitedOre?: number; refundedOre?: number }
}

export interface OrderingState {
  open: boolean
  reason?: 'disabled' | 'no_payments' | 'paused' | 'closed'
  pickup?: boolean
  table?: boolean
  prepMinutes?: number
  closesAt?: string
  lastOrderAt?: string
  pausedUntil?: string
}

export interface OrderList {
  date: string
  ordering: OrderingState
  orders: Order[]
}

export type StaffMove = 'preparing' | 'ready' | 'completed' | 'cancelled'

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/orders`
}

/** Utan API: en bordsbeställning med burgarmeny, drink och allergi (köks- och barbong). */
export function mockOrders(): OrderList {
  const now = Date.now()
  const at = (min: number) => new Date(now - min * 60_000).toISOString()
  const line = (menuItemId: string, name: string, kr: number, quantity: number, extra: Partial<OrderLine> = {}) =>
    ({ menuItemId, name, unitPrice: kr * 100, quantity, total: kr * 100 * quantity, vatRate: 12, ...extra })
  return {
    date: new Date(now).toISOString().slice(0, 10),
    ordering: { open: true, pickup: true, table: true, prepMinutes: 20, lastOrderAt: '21:45' },
    orders: [
      {
        orderId: 'mockorder00000000000000000000001', locationId: 'mock', number: 12, status: 'confirmed',
        paymentStatus: 'paid', mode: 'table', tableId: 't7', tableLabel: '7', totalAmount: 51500, refundable: 51500,
        customerName: 'Åsa Öberg', confirmedAt: at(3),
        lines: [
          line('burgarmeny', 'Burgarmeny', 159, 1, { note: 'ingen lök', allergy: 'jordnötsallergi' }),
          line('skagen', 'Toast Skagen', 98, 2),
          line('mojito', 'Mojito', 125, 1),
          line('cola', 'Coca-Cola', 35, 2),
        ],
      },
      {
        orderId: 'mockorder00000000000000000000002', locationId: 'mock', number: 11, status: 'preparing',
        paymentStatus: 'partly_refunded', mode: 'pickup', totalAmount: 28500, customerName: 'Johan Lind',
        refund: { amount: 5000 }, refundable: 23500,
        customerPhone: '070-123 45 67', confirmedAt: at(14), readyEstimate: new Date(now + 6 * 60_000).toISOString(),
        lines: [line('pizza', 'Pizza Margherita', 125, 2), line('cola', 'Coca-Cola', 35, 1)],
      },
    ],
  }
}

export function listOrders(locationId: string, date?: string): Promise<OrderList> {
  if (!isApiConfigured()) return Promise.resolve(date ? { ...mockOrders(), orders: [] } : mockOrders())
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiFetch<OrderList>(`${base(locationId)}${query}`)
}

export function moveOrder(
  locationId: string,
  order: Pick<Order, 'orderId' | 'status'>,
  status: StaffMove,
): Promise<Order> {
  return apiFetch<Order>(`${base(locationId)}/${order.orderId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, expectedStatus: order.status }),
  })
}

/** Ägaren återbetalar (en del av) kortbetalningen utan att avbryta. */
export function refundOrder(
  locationId: string,
  order: Order,
  input: { amount: number; reason?: string; notifyGuest: boolean },
): Promise<Order> {
  if (!isApiConfigured()) {
    const amount = (order.refund?.amount ?? 0) + input.amount
    const refundable = Math.max((order.refundable ?? 0) - input.amount, 0)
    return withBusy(async (): Promise<Order> => ({
      ...order,
      refund: { amount, items: [...(order.refund?.items ?? []), { amount: input.amount, reason: input.reason }] },
      refundable,
      paymentStatus: refundable > 0 ? 'partly_refunded' : 'refunded',
    }))
  }
  return apiFetch<Order>(`${base(locationId)}/${order.orderId}/refund`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** "Delvis återbetald 50 kr" / "Återbetald 285,50 kr", eller null. */
export function refundLabel(order: Order): string | null {
  const amount = order.refund?.amount ?? 0
  if (amount <= 0 || order.status === 'cancelled') return null
  return `${order.paymentStatus === 'refunded' ? 'Återbetald' : 'Delvis återbetald'} ${kronor(amount)}`
}

export function pauseOrdering(locationId: string, minutes: number): Promise<{ ordering: OrderingState }> {
  return apiFetch(`${base(locationId)}/pause`, {
    method: 'PUT',
    body: JSON.stringify({ minutes }),
  })
}

/** "285,50 kr" från öre. */
export function kronor(ore: number): string {
  const text = (ore / 100).toFixed(2).replace('.', ',')
  return `${text.endsWith(',00') ? text.slice(0, -3) : text} kr`
}

/** "18:40" i restaurangens tid (platsens tidszon, annars Europe/Stockholm),
 * inte enhetens: en surfplatta på UTC eller en ägare på resa ser samma tid. */
export function clock(iso: string | undefined, timezone?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const fmt = (timeZone: string) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  try {
    return fmt(timezone || 'Europe/Stockholm')
  } catch {
    return fmt('Europe/Stockholm')
  }
}

const MOVE_ERRORS: Record<string, string> = {
  changed_retry: 'Någon annan ändrade beställningen nyss. Nu syns det senaste.',
  refund_failed: 'Stripe kunde inte betala tillbaka, så beställningen är inte avbruten. Försök igen om en stund, eller rapportera det till Booqy.',
  payment_unavailable: 'Stripe svarar inte just nu. Det är inte ert fel. Försök igen om en stund, eller rapportera det till Booqy.',
}

export function moveErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    // Via errorText så felrutan vet vem som gör något (Stripe nere: Försök igen).
    if (MOVE_ERRORS[err.message]) return commonError(err, 'Beställningen ändrades inte.', { [err.code]: MOVE_ERRORS[err.message] })
    if (err.message.startsWith('cannot_move_')) return 'Beställningen kan inte flyttas dit längre. Nu syns det senaste.'
    if (err.status === 404 && err.code !== 'route_not_found') return 'Beställningen finns inte längre. Nu syns det som finns kvar.'
  }
  return commonError(err, 'Beställningen ändrades inte.')
}

export function closedText(state: OrderingState): string {
  switch (state.reason) {
    case 'disabled':
      return 'Beställning är avstängd. Slå på den under Inställningar, Beställning, Beställning och QR-koder.'
    case 'no_payments':
      return 'Stripe-kontot kan inte ta emot betalningar än (se Inställningar, Ekonomi, Betalningar).'
    case 'paused':
      return `Pausat till ${clock(state.pausedUntil)} - gästerna kan inte beställa.`
    case 'closed':
    default:
      return 'Stängt för beställningar just nu (utanför öppettiderna eller efter sista beställning).'
  }
}
