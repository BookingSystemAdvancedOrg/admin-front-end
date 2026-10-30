import { errorText as commonError } from '../../shared/errors'
import { ApiError, apiFetch } from '../../shared/api'

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
}

export interface Order {
  orderId: string
  locationId: string
  number?: number
  status: OrderStatus
  paymentStatus?: 'processing' | 'paid' | 'failed' | 'refunded'
  mode: OrderMode
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

export interface TableCode {
  tableId: string
  label: string
  code: string
  /** Gästsidans adress att lägga i QR-koden; null = restaurangen saknar webbadress. */
  url: string | null
}

function base(locationId: string): string {
  return `/locations/${encodeURIComponent(locationId)}/orders`
}

export function listOrders(locationId: string, date?: string): Promise<OrderList> {
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

export function tableCodes(
  locationId: string,
  tables: { tableId: string; label: string }[],
): Promise<{ tables: TableCode[] }> {
  return apiFetch(`${base(locationId)}/table-codes`, {
    method: 'POST',
    body: JSON.stringify({ tables }),
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
