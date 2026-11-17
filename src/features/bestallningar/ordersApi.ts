import { errorText as commonError } from '../../shared/errors'
import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
import { withBusy } from '../../shared/motion/busy'
import { tableTitle } from '../table-qr/tableQrApi'

/**
 * Matbeställningar (backend manage-order, docs/ORDERS.md i application).
 *
 * Gästen beställer och betalar online (Stripe). Betalda beställningar syns
 * här som "confirmed"; en QR-beställning vid bordet kommer obetald
 * ("unpaid", payLater) och hamnar på bordets nota (TableTab), som gästen
 * betalar innan hen går. Personalen flyttar dem till tillagas -> klar ->
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

export type PaymentStatus =
  | 'processing'
  | 'paid'
  | 'failed'
  | 'partly_refunded'
  | 'refunded'
  /** Hos köket, på bordets nota, inte betald än. */
  | 'unpaid'
  | 'paid_outside'
  | 'written_off'
  /** En obetald beställning som avbröts: inget att betala tillbaka. */
  | 'void'

export type OutsideMethod = 'card_terminal' | 'cash' | 'swish' | 'other'

export const OUTSIDE_METHOD_TEXT: Record<OutsideMethod, string> = {
  card_terminal: 'Kort i egen terminal',
  cash: 'Kontant',
  swish: 'Swish',
  other: 'Annat',
}

/** "Obetald", "Betald utanför Booqy", "Avskriven", "Avbruten" eller null. */
export function paymentLabel(order: Pick<Order, 'paymentStatus'>): string | null {
  switch (order.paymentStatus) {
    case 'unpaid':
      return 'Obetald'
    case 'paid_outside':
      return 'Betald utanför Booqy'
    case 'written_off':
      return 'Avskriven'
    case 'void':
      return 'Avbruten'
    default:
      return null
  }
}

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
  paymentStatus?: PaymentStatus
  mode: OrderMode
  /** QR-beställning vid bordet som betalas på notan innan gästen går. */
  payLater?: boolean
  /** Serveringsdagen notan hör till (kan skilja från date efter midnatt). */
  serviceDate?: string
  date?: string
  /** Notan (betalningen) som betalade beställningen. */
  billId?: string
  paidAt?: string
  /** Personalen: gästen betalade utanför Booqy. */
  paidOutside?: { method: OutsideMethod; note?: string; by?: string; at?: string }
  /** Ägaren skrev av notan (obetald). */
  writtenOff?: { reason: string; by?: string; at?: string }
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

/** Platsens dag "2026-11-17" (Europe/Stockholm), med `days` dagar framåt eller bakåt. */
function stockholmDate(ms: number, days = 0): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(ms + days * 86_400_000))
}

/**
 * Utan API: en betald bordsbeställning med burgarmeny, drink och allergi
 * (köks- och barbong), en avhämtning, och två obetalda notor (bord 4 i
 * kväll och bord 2 från igår, gul).
 */
export function mockOrders(): OrderList {
  const now = Date.now()
  const at = (min: number) => new Date(now - min * 60_000).toISOString()
  const today = stockholmDate(now)
  const yesterday = stockholmDate(now, -1)
  const line = (menuItemId: string, name: string, kr: number, quantity: number, extra: Partial<OrderLine> = {}) =>
    ({ menuItemId, name, unitPrice: kr * 100, quantity, total: kr * 100 * quantity, vatRate: 12, ...extra })
  const unpaid = (id: string, number: number, tableId: string, tableLabel: string, date: string, minutes: number,
    status: OrderStatus, lines: OrderLine[]): Order => ({
    orderId: `mockorder0000000000000000000000${id}`, locationId: 'mock', number, status, paymentStatus: 'unpaid',
    payLater: true, serviceDate: date, date, mode: 'table', tableId, tableLabel, customerName: 'Gäst vid bordet',
    customerPhone: '070-765 43 21', confirmedAt: at(minutes), createdAt: at(minutes), lines,
    totalAmount: lines.reduce((sum, l) => sum + l.total, 0), refundable: 0,
  })
  return {
    date: today,
    ordering: { open: true, pickup: true, table: true, prepMinutes: 20, lastOrderAt: '21:45' },
    orders: [
      {
        orderId: 'mockorder00000000000000000000001', locationId: 'mock', number: 12, status: 'confirmed',
        paymentStatus: 'paid', mode: 'table', tableId: 't7', tableLabel: '7', totalAmount: 51500, refundable: 51500,
        customerName: 'Åsa Öberg', confirmedAt: at(3), date: today,
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
        refund: { amount: 5000 }, refundable: 23500, date: today,
        customerPhone: '070-123 45 67', confirmedAt: at(14), readyEstimate: new Date(now + 6 * 60_000).toISOString(),
        lines: [line('pizza', 'Pizza Margherita', 125, 2), line('cola', 'Coca-Cola', 35, 1)],
      },
      unpaid('03', 9, 't4', '4', today, 48, 'completed', [line('pizza', 'Pizza Margherita', 125, 2), line('ol', 'Lager 40 cl', 72, 2)]),
      unpaid('04', 13, 't4', '4', today, 6, 'preparing', [line('tiramisu', 'Tiramisu', 85, 2)]),
      unpaid('05', 31, 't2', '2', yesterday, 60 * 20, 'completed', [line('burgarmeny', 'Burgarmeny', 159, 1), line('cola', 'Coca-Cola', 35, 1)]),
    ],
  }
}

/* Utan API: beställningarna lever i minnet, så notornas knappar går att prova. */
let mockState: OrderList | null = null

function mockStore(): OrderList {
  if (!mockState) mockState = mockOrders()
  return mockState
}

/** Testerna börjar om med färsk mockdata. */
export function resetOrdersMock(): void {
  mockState = null
}

export function listOrders(locationId: string, date?: string): Promise<OrderList> {
  if (!isApiConfigured()) {
    const store = mockStore()
    if (date) return Promise.resolve({ ...store, date, orders: [] })
    return Promise.resolve({ ...store, orders: store.orders.filter((o) => (o.date ?? store.date) === store.date) })
  }
  const query = date ? `?date=${encodeURIComponent(date)}` : ''
  return apiFetch<OrderList>(`${base(locationId)}${query}`)
}

export function moveOrder(
  locationId: string,
  order: Pick<Order, 'orderId' | 'status'>,
  status: StaffMove,
): Promise<Order> {
  if (!isApiConfigured()) {
    return withBusy(async () => {
      const store = mockStore()
      const found = store.orders.find((o) => o.orderId === order.orderId)
      if (!found) throw new ApiError(404, 'not found')
      const stamp = new Date().toISOString()
      const unpaid = found.paymentStatus === 'unpaid'
      Object.assign(found, {
        status,
        ...(status === 'cancelled' ? { cancelledAt: stamp, paymentStatus: unpaid ? 'void' : 'refunded', refundable: 0 } : {}),
        ...(status === 'ready' ? { readyAt: stamp } : {}),
        ...(status === 'completed' ? { completedAt: stamp } : {}),
      })
      return { ...found }
    })
  }
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
  bill_being_paid: 'Gästen betalar notan just nu, så beställningen är inte avbruten. Vänta en minut och försök igen.',
  bill_paid: 'Notan är redan betald, så beställningen är inte avbruten. Nu syns det senaste.',
  bill_processing: 'Gästens betalning håller på att godkännas, så beställningen är inte avbruten. Vänta en stund.',
  settled_outside_booqy: 'Beställningen är redan betald utanför Booqy eller avskriven, så den avbryts inte här.',
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

/* ---------- Notor vid bordet (backend: application shared/table_bills.py) ---------- */

/** Ett bords öppna nota: alla obetalda QR-beställningar vid bordet samma serveringsdag. */
export interface TableTab {
  tableId: string
  tableLabel?: string
  /** "Bord 7". */
  title: string
  serviceDate: string
  /** Öre att betala. */
  amount: number
  count: number
  oldestAt?: string
  orders: Order[]
  /** Gästen håller på att betala (låst till beloppet). */
  paying?: { billId: string; amount: number; startedAt?: string }
  /** Från en tidigare dag, eller restaurangen har stängt: gul. */
  stale: boolean
  /** Ägaren: en betalning täckte en beställning som redan var stängd. */
  mismatch?: { billId: string; orderIds: string[]; at?: string }
}

export interface TabList {
  /** Dagens serveringsdag. */
  serviceDate: string
  tabs: TableTab[]
}

export interface PayLink {
  url: string
  expiresAt: string
  amount: number
  count: number
}

export interface TabActionResult {
  tab: TableTab
  orders: Order[]
}

/** Nyckeln för en nota: samma bord kan ha en gammal och en ny nota. */
export function tabKey(tab: Pick<TableTab, 'serviceDate' | 'tableId'>): string {
  return `${tab.serviceDate}/${tab.tableId}`
}

function tabPath(locationId: string, tab: Pick<TableTab, 'serviceDate' | 'tableId'>, action: string): string {
  return `${base(locationId)}/tabs/${encodeURIComponent(tab.serviceDate)}/${encodeURIComponent(tab.tableId)}/${action}`
}

/** Notor ur mockdatans obetalda beställningar (som servern bygger dem). */
function mockTabList(): TabList {
  const store = mockStore()
  const byKey = new Map<string, TableTab>()
  for (const o of store.orders) {
    if (!o.payLater || o.paymentStatus !== 'unpaid' || !o.tableId || !o.serviceDate) continue
    const key = `${o.serviceDate}/${o.tableId}`
    const tab = byKey.get(key) ?? {
      tableId: o.tableId, tableLabel: o.tableLabel, title: tableTitle(o.tableLabel ?? '?'), serviceDate: o.serviceDate,
      amount: 0, count: 0, orders: [], stale: o.serviceDate < store.date,
    }
    tab.amount += o.totalAmount
    tab.count += 1
    tab.orders.push(o)
    if (!tab.oldestAt || (o.createdAt ?? '') < tab.oldestAt) tab.oldestAt = o.createdAt
    byKey.set(key, tab)
  }
  const tabs = [...byKey.values()].sort((a, b) => (a.oldestAt ?? '~').localeCompare(b.oldestAt ?? '~'))
  return { serviceDate: store.date, tabs: structuredClone(tabs) }
}

/** Alla öppna notor, äldst först (Beställningar, Layout). */
export function listTabs(locationId: string): Promise<TabList> {
  if (!isApiConfigured()) return Promise.resolve(mockTabList())
  return apiFetch<TabList>(`${base(locationId)}/tabs`)
}

/** Länken (QR-koden) gästen betalar hela notan med. */
export function payLink(locationId: string, tab: TableTab): Promise<PayLink> {
  if (!isApiConfigured()) {
    return withBusy(async () => ({
      url: `https://example.se/notan/mock#L.${encodeURIComponent(tabKey(tab))}`,
      expiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
      amount: tab.amount,
      count: tab.count,
    }))
  }
  return apiFetch<PayLink>(tabPath(locationId, tab, 'pay-link'), { method: 'POST', body: '{}' })
}

/** Mockdatan: stäng notans beställningar på samma sätt som servern. */
function mockClose(tab: TableTab, expectedAmount: number, change: Partial<Order>): TabActionResult {
  const current = mockTabList().tabs.find((t) => tabKey(t) === tabKey(tab))
  if (!current) throw new ApiError(409, 'bill_empty')
  if (current.amount !== expectedAmount) throw new ApiError(409, 'bill_changed')
  const ids = new Set(current.orders.map((o) => o.orderId))
  const updated: Order[] = []
  for (const o of mockStore().orders) {
    if (!ids.has(o.orderId)) continue
    Object.assign(o, change)
    updated.push({ ...o })
  }
  return { tab: { ...current, amount: 0, count: 0, orders: [] }, orders: updated }
}

/** "Markera som betald": gästen betalade utanför Booqy (egen terminal, kontant, Swish). */
export function markPaidOutside(
  locationId: string,
  tab: TableTab,
  input: { method: OutsideMethod; note?: string; expectedAmount: number },
): Promise<TabActionResult> {
  if (!isApiConfigured()) {
    const at = new Date().toISOString()
    return withBusy(async () => mockClose(tab, input.expectedAmount, {
      paymentStatus: 'paid_outside', paidAt: at, paidOutside: { method: input.method, note: input.note, at },
    }))
  }
  return apiFetch<TabActionResult>(tabPath(locationId, tab, 'paid-outside'), {
    method: 'POST',
    body: JSON.stringify({ method: input.method, expectedAmount: input.expectedAmount, ...(input.note ? { note: input.note } : {}) }),
  })
}

/** Ägaren: "Skriv av" notan (gästen gick utan att betala). */
export function writeOff(
  locationId: string,
  tab: TableTab,
  input: { reason: string; expectedAmount: number },
): Promise<TabActionResult> {
  if (!isApiConfigured()) {
    return withBusy(async () => mockClose(tab, input.expectedAmount, {
      paymentStatus: 'written_off', writtenOff: { reason: input.reason, at: new Date().toISOString() },
    }))
  }
  return apiFetch<TabActionResult>(tabPath(locationId, tab, 'write-off'), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Ägaren: den flaggade betalningen är kontrollerad. */
export function mismatchChecked(locationId: string, tab: TableTab): Promise<{ ok: boolean }> {
  if (!isApiConfigured()) return withBusy(async () => ({ ok: true }))
  return apiFetch(tabPath(locationId, tab, 'mismatch-checked'), { method: 'POST', body: '{}' })
}

/** Serverns koder för notorna; varje text säger vem som gör något. */
export const TAB_ERRORS: Record<string, string> = {
  bill_being_paid: 'Gästen betalar notan just nu. Vänta en minut.',
  bill_changed: 'Notan har ändrats. Kontrollera beloppet och spara igen.',
  bill_paid: 'Notan är redan betald.',
  bill_processing: 'Gästens betalning håller på att godkännas. Vänta en stund, notan uppdateras av sig själv.',
  bill_empty: 'Notan är redan stängd. Nu syns det senaste.',
  changed_retry: 'Någon annan ändrade notan nyss. Nu syns det senaste.',
  owner_only: 'Bara ägaren kan skriva av en nota.',
  ordering_no_site: 'Restaurangen har ingen webbadress än, så det finns ingen sida att betala på. Booqy lägger upp er webbplats; hör av er till Booqy om det dröjer.',
  payment_unavailable: 'Stripe svarar inte just nu. Det är inte ert fel. Försök igen om en stund, eller rapportera det till Booqy.',
}

/** Koder som betyder att listan ska hämtas om (beloppet eller läget har ändrats). */
export const TAB_REFRESH = new Set(['bill_changed', 'bill_paid', 'bill_empty', 'changed_retry', 'bill_processing', 'bill_being_paid'])

export function tabErrorText(err: unknown, action: string): string {
  return commonError(err, action, TAB_ERRORS)
}
