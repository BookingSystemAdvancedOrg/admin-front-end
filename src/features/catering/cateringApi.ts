import { ApiError, apiFetch } from '../../shared/api'

/**
 * Catering (backend: catering-settings, catering-discount-tiers,
 * catering-requests, catering-offer - infrastructure docs/CATERING-FLOW.md).
 *
 * Flödet: gästen skickar en förfrågan från kalkylen på webbplatsen ->
 * ägaren får sms + mejl med länk hit -> ägaren justerar och skickar en
 * offert (eller tackar nej) -> gästen signerar med BankID eller ber om
 * ändringar -> privatperson betalar online, företag får en Stripe-faktura
 * -> levererad -> klar när den är både levererad och betald.
 *
 * Belopp från API:t är i öre; det ägaren skriver in (offertrader,
 * leveransavgift) skickas i kronor.
 */

export interface CateringSettings {
  enabled: boolean
  minPortions: number
  maxPortions: number
  advanceDays: number
  maxPortionsPerDay: number | null
  pickup: boolean
  delivery: boolean
  deliveryArea: string
  maxDistanceKm: number
  priceWithinLimit: number
  priceBeyondLimit: number
  allowOutsideArea: boolean
  offerValidDays: number
  paymentTermsDays: number
  requestExpiryHours: number
  terms: string
  notifyEmail: string | null
  notifyPhone: string | null
}

export const DEFAULT_SETTINGS: CateringSettings = {
  enabled: false,
  minPortions: 10,
  maxPortions: 300,
  advanceDays: 5,
  maxPortionsPerDay: null,
  pickup: true,
  delivery: true,
  deliveryArea: '',
  maxDistanceKm: 25,
  priceWithinLimit: 395,
  priceBeyondLimit: 795,
  allowOutsideArea: false,
  offerValidDays: 7,
  paymentTermsDays: 30,
  requestExpiryHours: 72,
  terms: '',
  notifyEmail: null,
  notifyPhone: null,
}

export interface Tier {
  tierId: string
  name: string
  fromPortions: number
  toPortions: number | null
  discountPercent: number
  active: boolean
}

export type TierInput = Omit<Tier, 'tierId'>

export type CateringStatus =
  | 'requested'
  | 'offer_sent'
  | 'change_requested'
  | 'signed'
  | 'confirmed'
  | 'delivered'
  | 'closed'
  | 'declined'
  | 'rejected'
  | 'expired'
  | 'cancelled'

export const STATUS_LABEL: Record<CateringStatus, string> = {
  requested: 'Ny förfrågan',
  offer_sent: 'Offert skickad',
  change_requested: 'Ändring önskas',
  signed: 'Signerad',
  confirmed: 'Bekräftad',
  delivered: 'Levererad',
  closed: 'Klar',
  declined: 'Nekad',
  rejected: 'Avböjd av kunden',
  expired: 'Utgången',
  cancelled: 'Avbokad',
}

/** Väntar på restaurangen. */
export const NEEDS_OWNER: CateringStatus[] = ['requested', 'change_requested']

export interface Line {
  menuItemId?: string
  name: string
  /** Öre. */
  unitPrice: number
  quantity: number
}

export interface Totals {
  subtotal: number
  discountPercent: number
  discount: number
  deliveryFee: number
  total: number
  vat: number
  vatRate: number
}

export interface Offer {
  version: number
  lines: Line[]
  totals: Totals
  validUntil: string
  message?: string
  documentHash?: string
  createdAt?: string
  portions?: number
}

export interface RequestSummary {
  requestId: string
  status: CateringStatus
  customerType: 'private' | 'company'
  customerName: string
  companyName?: string
  deliveryDate: string
  deliveryTime: string
  fulfilment: 'pickup' | 'delivery'
  createdAt: string
  portions?: number
  total?: number
  paid?: boolean
  invoiceStatus?: string
}

export interface CateringRequest extends RequestSummary {
  locationId: string
  version: number
  customerEmail: string
  customerPhone: string
  orgNumber?: string
  invoiceReference?: string
  deliveryAddress?: { street: string; postalCode: string; city: string }
  deliveryZone?: 'within' | 'beyond'
  guests?: number
  notes?: string
  request: { lines: Line[]; portions: number; tierName?: string | null } & Totals
  draft?: Omit<Offer, 'version'>
  offer?: Offer
  offers: Offer[]
  currentOfferVersion?: number
  validUntil?: string
  changeMessage?: string
  declineReason?: string
  rejectReason?: string
  cancelReason?: string
  refundNote?: string
  signature?: { name: string; personalNumberMasked: string; signedAt: string; documentHash: string }
  stripeInvoiceId?: string
  invoiceNumber?: string
  invoiceUrl?: string
  capacityHeld?: number
  capacityLeft: number | null
  history: { action: string; by: string; at: string; [k: string]: unknown }[]
}

/** Det ägaren skickar som offert - priser i kronor. */
export interface OfferInput {
  lines: { menuItemId?: string; name: string; unitPrice: number; quantity: number }[]
  discountPercent: number
  deliveryFee: number
  message: string
  validUntil?: string
}

const loc = (locationId: string) => `/locations/${encodeURIComponent(locationId)}/catering`
const req = (locationId: string, requestId: string) =>
  `${loc(locationId)}/requests/${encodeURIComponent(requestId)}`

export function saveSettings(locationId: string, settings: Partial<CateringSettings>): Promise<CateringSettings> {
  return apiFetch(`${loc(locationId)}/settings`, { method: 'PUT', body: JSON.stringify(settings) })
}

export async function listTiers(locationId: string): Promise<Tier[]> {
  return (await apiFetch<{ tiers: Tier[] }>(`${loc(locationId)}/discount-tiers`)).tiers
}

export function createTier(locationId: string, tier: TierInput): Promise<Tier> {
  return apiFetch(`${loc(locationId)}/discount-tiers`, { method: 'POST', body: JSON.stringify(tier) })
}

export function updateTier(locationId: string, tierId: string, tier: TierInput): Promise<Tier> {
  return apiFetch(`${loc(locationId)}/discount-tiers/${tierId}`, { method: 'PUT', body: JSON.stringify(tier) })
}

export function deleteTier(locationId: string, tierId: string): Promise<void> {
  return apiFetch(`${loc(locationId)}/discount-tiers/${tierId}`, { method: 'DELETE' })
}

export async function listRequests(locationId: string): Promise<RequestSummary[]> {
  return (await apiFetch<{ requests: RequestSummary[] }>(`${loc(locationId)}/requests`)).requests
}

export function getRequest(locationId: string, requestId: string): Promise<CateringRequest> {
  return apiFetch(req(locationId, requestId))
}

export function saveDraft(locationId: string, requestId: string, offer: OfferInput): Promise<CateringRequest> {
  return apiFetch(`${req(locationId, requestId)}/offer`, { method: 'PUT', body: JSON.stringify(offer) })
}

export function sendOffer(locationId: string, requestId: string, offer: OfferInput): Promise<CateringRequest> {
  return apiFetch(`${req(locationId, requestId)}/offer/send`, { method: 'POST', body: JSON.stringify(offer) })
}

export function declineRequest(locationId: string, requestId: string, reason: string): Promise<CateringRequest> {
  return apiFetch(`${req(locationId, requestId)}/decline`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function cancelRequest(locationId: string, requestId: string, reason: string): Promise<CateringRequest> {
  return apiFetch(`${req(locationId, requestId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
}

export function markDelivered(locationId: string, requestId: string): Promise<CateringRequest> {
  return apiFetch(`${req(locationId, requestId)}/delivered`, { method: 'POST' })
}

export function markInvoicePaid(locationId: string, invoiceId: string): Promise<unknown> {
  return apiFetch(`${loc(locationId)}/invoices/${encodeURIComponent(invoiceId)}/mark-paid`, { method: 'POST' })
}

export function signatureLink(locationId: string, requestId: string): Promise<{ url: string }> {
  return apiFetch(`${req(locationId, requestId)}/documents/signature`)
}

/** Förfrågans rader som offertutkast (kronor). */
export function offerFromRequest(r: CateringRequest): OfferInput {
  const source = r.draft ?? r.offer
  const lines = source?.lines ?? r.request.lines
  const totals = source?.totals ?? r.request
  return {
    lines: lines.map((l) => ({
      ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
      name: l.name,
      unitPrice: Number(l.unitPrice) / 100,
      quantity: Number(l.quantity),
    })),
    discountPercent: Number(totals.discountPercent ?? 0),
    deliveryFee: Number(totals.deliveryFee ?? 0) / 100,
    message: source?.message ?? '',
    validUntil: source?.validUntil,
  }
}

/** Samma räkning som servern (shared/catering.py totals), i öre. */
export function offerTotals(offer: OfferInput): Totals {
  const subtotal = offer.lines.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity, 0)
  const discount = Math.round((subtotal * offer.discountPercent) / 100)
  const total = subtotal - discount + Math.round(offer.deliveryFee * 100)
  return {
    subtotal,
    discountPercent: offer.discountPercent,
    discount,
    deliveryFee: Math.round(offer.deliveryFee * 100),
    total,
    vat: Math.round((total * 12) / 112),
    vatRate: 12,
  }
}

export function kronor(ore: number | undefined | null): string {
  const value = Number(ore ?? 0) / 100
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: value % 1 ? 2 : 0, minimumFractionDigits: value % 1 ? 2 : 0 }).format(value)} kr`
}

const ERRORS: Record<string, string> = {
  changed_retry: 'Förfrågan har just ändrats (av kunden eller någon annan). Sidan är uppdaterad - försök igen.',
  capacity_full: 'Dagen är fullbokad för catering (max portioner per dag). Minska antalet eller tacka nej.',
  not_editable: 'Offerten kan inte ändras i den här statusen.',
  not_declinable: 'Förfrågan kan inte nekas i den här statusen.',
  not_cancellable: 'Beställningen kan inte avbokas i den här statusen.',
  not_confirmed: 'Bara bekräftade beställningar kan markeras som levererade.',
  payment_provider_rejected: 'Stripe nekade åtgärden. Kontrollera i Stripe och försök igen.',
  payment_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund.',
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (ERRORS[err.message]) return ERRORS[err.message]
    if (/^price may be at most/.test(err.message)) return 'Pris per rad får vara högst 10 000 kr.'
    if (/^offer total may be at most/.test(err.message)) return 'Offerten är för stor (högst 500 000 kr totalt).'
    if (err.status === 400) return `Kontrollera uppgifterna: ${err.message}`
    if (err.status === 403) return 'Bara restaurangens ägare kan göra det.'
    if (err.status === 404) return 'Förfrågan finns inte.'
  }
  return 'Kunde inte spara just nu. Försök igen om en stund.'
}

export function formatDate(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return Number.isNaN(d.getTime())
    ? day
    : new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }).format(d)
}

export function statusClass(status: CateringStatus): string {
  if (NEEDS_OWNER.includes(status)) return 'waiting'
  if (['confirmed', 'delivered', 'closed', 'signed'].includes(status)) return 'reserved'
  if (status === 'offer_sent') return 'arrived'
  return 'cancelled'
}
