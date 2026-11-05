import { apiFetch } from '../../shared/api'

/** Evenemang och biljetter (CONTRACTS.md 6.K). Redigering är ägarens; personalen ser listan och sköter insläppet. */

export type EventStatus = 'draft' | 'published' | 'cancelled'
export type TicketStatus = 'valid' | 'checked_in' | 'transferred' | 'refunded' | 'void'
export type VatRate = 25 | 12 | 6

/** `resaleAllowed`: gästen får sälja sin biljett vidare till samma pris via er webbplats (ADR-K 8), av som standard. */
export interface Settings { perOrderMax: number; transferAllowed: boolean; resaleAllowed?: boolean; refundPolicy?: string; tablePick?: boolean }
export interface Series { freq: 'weekly' | 'monthly'; until: string; exceptions?: string[] }
export interface Occurrence {
  occurrenceId: string; startAt: string; endAt: string; capacity: number; sold: number; held: number; checkedIn: number
  left: number; status: 'scheduled' | 'cancelled' | 'done'; version: number; revenueOre?: number
  salesOpenAt?: string; salesCloseAt?: string; doorsAt?: string
  /** Biljetter som gäster just nu har lagt ut till försäljning (bara när vidareförsäljning är på). */
  resaleListed?: number
}
/** listed = ute till försäljning, sold = såld vidare (ogiltig), bought = köpt i andra hand. */
export type ResaleState = 'listed' | 'sold' | 'bought'
export interface TicketType {
  typeId: string; name: string; priceOre: number; vatRate: VatRate; perOrderMax: number; sortOrder: number
  capacity?: number; includes?: string; tier?: { availableFrom?: string; availableUntil?: string; untilSold?: number }
  sold: number; version: number
}
export interface EventDetail {
  eventId: string; locationId: string; title: string; description: string; status: EventStatus; settings: Settings
  series?: Series; version: number; occurrences: Occurrence[]; ticketTypes: TicketType[]
}
export interface EventSummary { eventId: string; title: string; status: EventStatus; nextOccurrence: string | null; sold: number; capacity: number }
export interface Ticket {
  ticketId: string; typeId: string; typeName: string; holderName: string; status: TicketStatus; checkedInAt?: string
  resale?: ResaleState
}
export interface Order {
  orderId: string; occurrenceId: string; qty: number; amountOre: number; refundedOre: number; status: string
  buyerName?: string; buyerEmail?: string; createdAt: string; paidAt?: string; tickets: Ticket[]
  /** Ett andrahandsköp: biljetterna kommer från andra gäster, inga nya platser. */
  resale?: boolean
}
export interface GuestList { scanKey: string; tickets: Ticket[]; counters: { sold: number; checkedIn: number; capacity: number } }
export interface CheckIn { ticketId: string; sig: string; at: string; clientId: string }
export interface CheckInResult { clientId: string; status: 'ok' | 'already' | 'invalid' | 'void'; at?: string; by?: string }
export interface NewEvent {
  eventId: string; title: string; description: string
  occurrences: { startAt: string; endAt: string; capacity: number; salesCloseAt?: string }[]
  series?: Series
  ticketTypes: { typeId: string; name: string; priceOre: number; vatRate: VatRate; perOrderMax: number; sortOrder: number; capacity?: number; includes?: string }[]
  settings: Settings
}

const base = (loc: string) => `/locations/${encodeURIComponent(loc)}/events`
const ev = (loc: string, id: string) => `${base(loc)}/${encodeURIComponent(id)}`
const occ = (loc: string, id: string, occId: string) => `${ev(loc, id)}/occurrences/${encodeURIComponent(occId)}`

export const listEvents = (loc: string) => apiFetch<{ events: EventSummary[]; cursor: string | null }>(base(loc))
export const createEvent = (loc: string, body: NewEvent) =>
  apiFetch<EventDetail>(base(loc), { method: 'POST', body: JSON.stringify(body) })
export const getEvent = (loc: string, id: string) => apiFetch<EventDetail>(ev(loc, id))
export const updateEvent = (loc: string, id: string, body: { title: string; description: string; settings: Settings; series?: Series; version: number }) =>
  apiFetch<EventDetail>(ev(loc, id), { method: 'PUT', body: JSON.stringify(body) })
export const publishEvent = (loc: string, id: string, version: number) =>
  apiFetch<EventDetail>(`${ev(loc, id)}/publish`, { method: 'POST', body: JSON.stringify({ version }) })
export const updateOccurrence = (loc: string, id: string, occId: string, body: { capacity?: number; version: number }) =>
  apiFetch<Occurrence>(occ(loc, id, occId), { method: 'PUT', body: JSON.stringify(body) })
export const cancelOccurrence = (loc: string, id: string, occId: string, body: { jobId: string; version: number; message?: string }) =>
  apiFetch<{ jobId: string; toRefund: number }>(`${occ(loc, id, occId)}/cancel`, { method: 'POST', body: JSON.stringify(body) })
export const getJob = (loc: string, jobId: string) =>
  apiFetch<{ jobId: string; kind: string; done: boolean; toRefund: number; counts: { refunded: number; failed: number; notified: number } }>(
    `${base(loc)}/jobs/${encodeURIComponent(jobId)}`)
export const getGuestList = (loc: string, id: string, occId: string) => apiFetch<GuestList>(`${occ(loc, id, occId)}/guest-list`)
export const sendCheckIns = (loc: string, id: string, occId: string, checkIns: CheckIn[]) =>
  apiFetch<{ results: CheckInResult[] }>(`${occ(loc, id, occId)}/check-ins`, { method: 'POST', body: JSON.stringify({ checkIns }) })
export const listOrders = (loc: string, id: string) => apiFetch<{ orders: Order[]; cursor: string | null }>(`${ev(loc, id)}/orders`)
/**
 * En återbetalning per biljett: txId härleds ur biljettens id, så ett nytt
 * försök (Stripe nere, tappad anslutning) är samma återbetalning för servern
 * och pengarna går aldrig tillbaka två gånger.
 */
export const refundTxId = (ticketId: string) => `rf_${ticketId}`
export const refundTicket = (loc: string, ticketId: string, reason: string) =>
  apiFetch<Ticket>(`${base(loc)}/tickets/${encodeURIComponent(ticketId)}/refund`, {
    method: 'POST', body: JSON.stringify({ txId: refundTxId(ticketId), reason }),
  })

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function kr(ore: number): string {
  return `${(ore / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} kr`
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
}

export const STATUS_LABEL: Record<EventStatus, string> = { draft: 'Utkast', published: 'Publicerat', cancelled: 'Inställt' }
export const TICKET_LABEL: Record<TicketStatus, string> = {
  valid: 'Giltig', checked_in: 'Insläppt', transferred: 'Bortgiven', refunded: 'Återbetald', void: 'Ogiltig',
}
export const RESALE_LABEL: Record<ResaleState, string> = {
  listed: 'Till salu i andra hand', sold: 'Såld vidare', bought: 'Köpt i andra hand',
}

/** Biljettens status för ägaren: en vidaresåld biljett heter så, inte bara "Ogiltig". */
export function ticketLabel(t: Pick<Ticket, 'status' | 'resale'>): string {
  if (t.resale === 'sold') return RESALE_LABEL.sold
  const base = TICKET_LABEL[t.status]
  return t.resale ? `${base} (${RESALE_LABEL[t.resale].toLowerCase()})` : base
}

export const ERRORS: Record<string, string> = {
  invalid_capacity: 'Antalet platser måste vara minst så många som redan är sålda.',
  invalid_price: 'Priset ska vara 0 kr eller mer.',
  invalid_vat_rate: 'Välj en av momssatserna i listan.',
  invalid_window: 'Kontrollera tiderna: slutet ska vara efter starten och försäljningen ska stänga före slutet.',
  invalid_series: 'Upprepningen kan sträcka sig högst ett år framåt.',
  invalid_state: 'Det går inte i det här läget.',
  has_sales: 'Biljettypen har redan sålts och kan inte tas bort eller få nytt pris.',
  changed_retry: 'Någon annan ändrade samtidigt. Ladda om och försök igen.',
  stripe_unavailable: 'Betalningen kunde inte återbetalas just nu. Försök igen om en stund.',
  owner_only: 'Bara ägaren kan göra det här.',
  too_many_tickets: 'Max antal biljetter per köp ska vara 1-20.',
}
