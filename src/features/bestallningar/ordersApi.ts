import { errorText as commonError } from '../../shared/errors'
import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Matbeställningar (backend manage-order, docs/ORDERS.md i application).
 *
 * Gästen beställer och betalar online (Stripe). Betalda beställningar syns
 * här som "confirmed"; personalen flyttar dem till tillagas -> klar ->
 * hämtad/serverad. "Klar" på en avhämtning skickar sms:et "klar att hämta"
 * till gästen. "Avbryt" återbetalar hela beloppet via Stripe.
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
  paymentStatus?: 'processing' | 'paid' | 'failed' | 'refunded'
  mode: OrderMode
  /** Bordets id i planritningen (QR-koden); står kvar om bordet byter namn. */
  tableId?: string
  /** Bordets namn när gästen beställde. */
  tableLabel?: string
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
        paymentStatus: 'paid', mode: 'table', tableId: 't7', tableLabel: '7', totalAmount: 51500,
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
        paymentStatus: 'paid', mode: 'pickup', totalAmount: 28500, customerName: 'Johan Lind',
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

/** "18:40" i webbläsarens (restaurangens) tid. */
export function clock(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit' }).format(d)
}

const MOVE_ERRORS: Record<string, string> = {
  changed_retry: 'Beställningen har just ändrats av någon annan. Listan är uppdaterad.',
  refund_failed: 'Stripe kunde inte återbetala beställningen. Den är inte avbruten - försök igen eller kontakta support.',
  payment_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund.',
}

export function moveErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (MOVE_ERRORS[err.message]) return MOVE_ERRORS[err.message]
    if (err.message.startsWith('cannot_move_')) return 'Beställningen kan inte flyttas dit. Listan är uppdaterad.'
    if (err.status === 404) return 'Beställningen finns inte längre.'
  }
  return commonError(err, 'Kunde inte spara beställningen.')
}

export function closedText(state: OrderingState): string {
  switch (state.reason) {
    case 'disabled':
      return 'Beställning är avstängd. Slå på den under Inställningar → Beställning.'
    case 'no_payments':
      return 'Stripe-kontot kan inte ta emot betalningar än (se Inställningar → Betalningar).'
    case 'paused':
      return `Pausat till ${clock(state.pausedUntil)} - gästerna kan inte beställa.`
    case 'closed':
    default:
      return 'Stängt för beställningar just nu (utanför öppettiderna eller efter sista beställning).'
  }
}
