import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
import { withBusy } from '../../shared/motion/busy'

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
 * leveransavgift, rengöringsavgift) skickas i kronor.
 *
 * Retur av utrustning: gästen väljer rengjord (gratis) eller ej rengjord
 * (platsens rengöringsavgift). Varje offertversion har en egen kopia av
 * valet och avgiften, så en signerad offert ändras aldrig när avgiften gör det.
 */

export type EquipmentReturn = 'cleaned' | 'not_cleaned'

export const EQUIPMENT_RETURN_LABEL: Record<EquipmentReturn, string> = {
  cleaned: 'Rengjord utrustning',
  not_cleaned: 'Ej rengjord utrustning',
}

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
  /** Kronor inkl. moms när gästen lämnar tillbaka utrustningen ej rengjord. */
  cleaningFee: number
  offerValidDays: number
  paymentTermsDays: number
  requestExpiryHours: number
  terms: string
  notifyEmail: string | null
  notifyPhone: string | null
  /** Minsta antal gäster för en förfrågan. */
  minGuests: number
  /** Framförhållning per antal gäster; tom lista = advanceDays för alla. */
  leadTimeRules: LeadTimeRule[]
  /** Leveranspris (kr) per avståndsintervall, stigande upToKm. */
  deliveryBands: DeliveryBand[]
  /** Alltid sista intervallets upToKm. */
  maxDeliveryKm: number | null
  /** Ny offert räknas med servering (12 % moms) i stället för bara mat. */
  defaultServiceIncluded: boolean
  /** Påminnelse till restaurangen om obesvarad förfrågan (0 = av). */
  ownerReminderHours: number
  /** Påminnelse till kunden om osignerad offert, dagar före sista dag (0 = av). */
  signReminderDaysBefore: number
  dayBeforeReminder: boolean
  /** Kunden får godkänna utan BankID (namn + kryssruta). */
  allowSimpleAcceptance: boolean
  /** Varifrån leveranser utgår (vägavstånd); tom = restaurangens adress. */
  originAddress: string
}

export interface LeadTimeRule {
  fromGuests: number
  /** null = och uppåt. */
  toGuests: number | null
  days: number
}

export interface DeliveryBand {
  upToKm: number
  /** Kronor inkl. moms. */
  price: number
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
  cleaningFee: 0,
  offerValidDays: 7,
  paymentTermsDays: 30,
  requestExpiryHours: 72,
  terms: '',
  notifyEmail: null,
  notifyPhone: null,
  minGuests: 15,
  leadTimeRules: [],
  deliveryBands: [],
  maxDeliveryKm: null,
  defaultServiceIncluded: true,
  ownerReminderHours: 24,
  signReminderDaysBefore: 2,
  dayBeforeReminder: true,
  allowSimpleAcceptance: false,
  originAddress: '',
}

/** Sparade inställningar utan intervall (äldre platser): samma översättning som servern gör. */
export function withBands(s: CateringSettings): CateringSettings {
  if (s.deliveryBands.length) return s
  const bands: DeliveryBand[] = [{ upToKm: Math.max(1, s.maxDistanceKm), price: s.priceWithinLimit }]
  if (s.allowOutsideArea && bands[0].upToKm < 1000) bands.push({ upToKm: 1000, price: s.priceBeyondLimit })
  return { ...s, deliveryBands: bands, maxDeliveryKm: bands[bands.length - 1].upToKm }
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

/** Statusens etikett; en ny förfrågan som ägaren börjat på är "Under granskning". */
export function statusLabel(r: { status: CateringStatus; reviewedAt?: string; restaurantSignedAt?: string }): string {
  if (r.status === 'requested' && r.reviewedAt) return 'Under granskning'
  if (r.status === 'offer_sent' && !r.restaurantSignedAt) return 'Väntar på er signatur'
  return STATUS_LABEL[r.status]
}

/** Vem som har signerat den aktuella offertversionen. */
export interface SignerState {
  name?: string
  role?: string
  method?: string
  signedAt?: string
}

export interface Line {
  menuItemId?: string
  dishId?: string
  packageId?: string
  kind?: 'package' | 'dish' | 'menu'
  vatRate?: number
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
  /** Saknas på offerter skickade innan valet fanns. */
  cleaningFee?: number
  total: number
  vat: number
  vatRate: number
  vatBreakdown?: { rate: number; gross: number; net: number; vat: number }[]
}

export interface Offer {
  version: number
  lines: Line[]
  totals: Totals
  equipmentReturn?: EquipmentReturn
  validUntil: string
  message?: string
  documentHash?: string
  createdAt?: string
  portions?: number
  serviceIncluded?: boolean
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
  /** Saknas på förfrågningar från innan valet fanns (= rengjord). */
  equipmentReturn?: EquipmentReturn
  guests?: number
  /** Ägaren har börjat på offerten ("Under granskning"). */
  reviewedAt?: string
  /** Restaurangen har signerat den skickade versionen; först då får kunden den. */
  restaurantSignedAt?: string
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
  notes?: string
  /** Företag: den som signerar, enligt kunden. */
  signatory?: { name: string; role: string; authorityConfirmed: boolean }
  serviceIncluded?: boolean
  request: { lines: Line[]; portions: number; tierName?: string | null; equipmentReturn?: EquipmentReturn;
    distanceKm?: number | null; deliveryFeeManual?: boolean } & Totals
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
  signature?: { name: string; personalNumberMasked?: string; signedAt: string; documentHash?: string; method?: string;
    role?: string; pdfSha256?: string }
  signing?: { offerVersion: number; pdfSha256?: string; restaurant?: SignerState; customer?: SignerState }
  signedPdfKey?: string
  stripeInvoiceId?: string
  invoiceNumber?: string
  invoiceUrl?: string
  capacityHeld?: number
  capacityLeft: number | null
  settings?: Partial<CateringSettings>
  history: { action: string; by: string; at: string; [k: string]: unknown }[]
}

/** Det ägaren skickar som offert - priser i kronor. */
export interface OfferInput {
  lines: { menuItemId?: string; dishId?: string; packageId?: string; name: string; unitPrice: number; quantity: number }[]
  /** Servering ingår (12 % moms); annars mat utan servering. */
  serviceIncluded: boolean
  discountPercent: number
  deliveryFee: number
  equipmentReturn: EquipmentReturn
  /** Kronor; räknas bara när equipmentReturn är not_cleaned. */
  cleaningFee: number
  message: string
  validUntil?: string
}

const loc = (locationId: string) => `/locations/${encodeURIComponent(locationId)}/catering`
const req = (locationId: string, requestId: string) =>
  `${loc(locationId)}/requests/${encodeURIComponent(requestId)}`

/** originFound: om leveransernas startadress hittas på kartan (null = leverans av eller tjänsten nere). */
export function saveSettings(locationId: string, settings: Partial<CateringSettings>):
  Promise<CateringSettings & { originFound?: boolean | null }> {
  if (!isApiConfigured()) return withBusy(async () => ({ ...DEFAULT_SETTINGS, ...settings, originFound: true }))
  return apiFetch(`${loc(locationId)}/settings`, { method: 'PUT', body: JSON.stringify(settings) })
}

export async function listTiers(locationId: string): Promise<Tier[]> {
  if (!isApiConfigured()) return MOCK_TIERS
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

// --- Cateringmeny (catering-menu, skild från den vanliga menyn) ---------------

export const ALLERGENS = ['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy', 'milk', 'nuts', 'celery',
  'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'] as const
export type Allergen = (typeof ALLERGENS)[number]
export const ALLERGEN_LABEL: Record<Allergen, string> = {
  gluten: 'Gluten', crustaceans: 'Kräftdjur', eggs: 'Ägg', fish: 'Fisk', peanuts: 'Jordnötter', soy: 'Soja',
  milk: 'Mjölk', nuts: 'Nötter', celery: 'Selleri', mustard: 'Senap', sesame: 'Sesamfrön',
  sulphites: 'Svaveldioxid och sulfiter', lupin: 'Lupin', molluscs: 'Blötdjur',
}
export const DIETARY = ['vegetarian', 'vegan', 'gluten_free', 'lactose_free'] as const
export type Dietary = (typeof DIETARY)[number]
export const DIETARY_LABEL: Record<Dietary, string> = {
  vegetarian: 'Vegetarisk', vegan: 'Vegansk', gluten_free: 'Glutenfri', lactose_free: 'Laktosfri',
}

export interface CateringDishInput {
  name: string
  description: string
  /** Kronor inkl. moms. */
  pricePerPortion: number
  allergens: Allergen[]
  dietary: Dietary[]
  active: boolean
  sort: number
  /** Rätten i den vanliga menyn den kopierades från ("Hämta från menyn"). */
  sourceMenuItemId?: string
}
export interface CateringDish extends CateringDishInput {
  dishId: string
  version: number
}

export interface CateringPackageInput {
  name: string
  description: string
  /** Kronor inkl. moms. */
  pricePerGuest: number
  dishIds: string[]
  minGuests?: number
  active: boolean
  sort: number
}
export interface CateringPackage extends CateringPackageInput {
  packageId: string
  version: number
}

const menu = (locationId: string) => `${loc(locationId)}/menu`

const MOCK_TIERS: Tier[] = [
  { tierId: 'niva-1', name: 'Nivå 1', fromPortions: 30, toPortions: 59, discountPercent: 5, active: true },
  { tierId: 'niva-2', name: 'Nivå 2', fromPortions: 60, toPortions: null, discountPercent: 10, active: true },
]
// Utan API (VITE_API_BASE_URL saknas) lever cateringmenyn i minnet.
const mock = {
  dishes: [
    { dishId: 'd1', name: 'Laxtallrik med dillsås', description: 'Ugnsbakad lax, kokt potatis', pricePerPortion: 145,
      allergens: ['fish', 'milk'], dietary: ['gluten_free'], active: true, sort: 0, version: 1 },
    { dishId: 'd2', name: 'Vegetarisk lasagne', description: 'Spenat och ricotta', pricePerPortion: 120,
      allergens: ['gluten', 'milk', 'eggs'], dietary: ['vegetarian'], active: true, sort: 1, version: 1 },
    { dishId: 'd3', name: 'Chokladtårta', description: '', pricePerPortion: 55, allergens: ['gluten', 'milk', 'eggs'],
      dietary: [], active: false, sort: 2, version: 1 },
  ] as CateringDish[],
  packages: [
    { packageId: 'p1', name: 'Mingelpaket', description: 'Lax och lasagne', pricePerGuest: 245, dishIds: ['d1', 'd2'],
      minGuests: 20, active: true, sort: 0, version: 1 },
  ] as CateringPackage[],
}

export async function listCateringDishes(locationId: string): Promise<CateringDish[]> {
  if (!isApiConfigured()) return [...mock.dishes]
  return (await apiFetch<{ dishes: CateringDish[] }>(`${menu(locationId)}/dishes`)).dishes
}

export async function listCateringPackages(locationId: string): Promise<CateringPackage[]> {
  if (!isApiConfigured()) return [...mock.packages]
  return (await apiFetch<{ packages: CateringPackage[] }>(`${menu(locationId)}/packages`)).packages
}

/** Personalen (inte ägaren) ser bara det gästerna ser: aktiva rätter och paket. */
export function getPublicCateringMenu(locationId: string): Promise<{ dishes: CateringDish[]; packages: CateringPackage[] }> {
  if (!isApiConfigured()) return Promise.resolve({ dishes: mock.dishes.filter((d) => d.active), packages: mock.packages })
  return apiFetch(menu(locationId))
}

export function saveCateringDish(locationId: string, dish: CateringDishInput, existing?: CateringDish): Promise<CateringDish> {
  if (!isApiConfigured()) {
    return withBusy(async () => {
      const saved = { ...dish, dishId: existing?.dishId ?? `d${Date.now()}`, version: (existing?.version ?? 0) + 1 }
      mock.dishes = existing ? mock.dishes.map((d) => (d.dishId === existing.dishId ? saved : d)) : [...mock.dishes, saved]
      return saved
    })
  }
  return existing
    ? apiFetch(`${menu(locationId)}/dishes/${existing.dishId}`, { method: 'PUT', body: JSON.stringify({ ...dish, version: existing.version }) })
    : apiFetch(`${menu(locationId)}/dishes`, { method: 'POST', body: JSON.stringify(dish) })
}

export function deleteCateringDish(locationId: string, dishId: string): Promise<void> {
  if (!isApiConfigured()) {
    return withBusy(async () => {
      if (mock.packages.some((p) => p.dishIds.includes(dishId))) throw new ApiError(409, 'dish_in_package')
      mock.dishes = mock.dishes.filter((d) => d.dishId !== dishId)
    })
  }
  return apiFetch(`${menu(locationId)}/dishes/${dishId}`, { method: 'DELETE' })
}

export function saveCateringPackage(locationId: string, pkg: CateringPackageInput, existing?: CateringPackage): Promise<CateringPackage> {
  if (!isApiConfigured()) {
    return withBusy(async () => {
      const saved = { ...pkg, packageId: existing?.packageId ?? `p${Date.now()}`, version: (existing?.version ?? 0) + 1 }
      mock.packages = existing ? mock.packages.map((p) => (p.packageId === existing.packageId ? saved : p)) : [...mock.packages, saved]
      return saved
    })
  }
  return existing
    ? apiFetch(`${menu(locationId)}/packages/${existing.packageId}`, { method: 'PUT', body: JSON.stringify({ ...pkg, version: existing.version }) })
    : apiFetch(`${menu(locationId)}/packages`, { method: 'POST', body: JSON.stringify(pkg) })
}

export function deleteCateringPackage(locationId: string, packageId: string): Promise<void> {
  if (!isApiConfigured()) {
    return withBusy(async () => {
      mock.packages = mock.packages.filter((p) => p.packageId !== packageId)
    })
  }
  return apiFetch(`${menu(locationId)}/packages/${packageId}`, { method: 'DELETE' })
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

/** En nedladdningslänk (5 minuter) till offerten, den signerade kopian eller signaturbeviset. */
export function documentLink(locationId: string, requestId: string, docId: 'offer' | 'signed' | 'signature'):
  Promise<{ url: string }> {
  return apiFetch(`${req(locationId, requestId)}/documents/${docId}`)
}

export interface SignStart {
  kind: 'bankid' | 'redirect'
  url?: string
  qrData?: string
  autoStartToken?: string
}

export interface SignPoll {
  state: 'pending' | 'failed' | 'signed'
  hint?: string
  qrData?: string
  request?: CateringRequest
}

/** Restaurangen signerar offerten (först), med BankID här eller på signeringstjänstens sida. */
export function restaurantSign(locationId: string, requestId: string): Promise<SignStart> {
  return apiFetch(`${req(locationId, requestId)}/restaurant-sign`, { method: 'POST' })
}

export function restaurantSignStatus(locationId: string, requestId: string): Promise<SignPoll> {
  return apiFetch(`${req(locationId, requestId)}/restaurant-sign/status`, { method: 'POST' })
}

/** Förfrågans rader som offertutkast (kronor). */
export function offerFromRequest(r: CateringRequest): OfferInput {
  const source = r.draft ?? r.offer
  const lines = source?.lines ?? r.request.lines
  const totals = source?.totals ?? r.request
  const equipmentReturn = source?.equipmentReturn ?? r.equipmentReturn ?? 'cleaned'
  // Avgiften som redan står i förfrågan/offerten, annars platsens nuvarande.
  const savedFee = Number(totals.cleaningFee ?? 0) / 100
  return {
    lines: lines.map((l) => ({
      ...(l.menuItemId ? { menuItemId: l.menuItemId } : {}),
      ...(l.dishId ? { dishId: l.dishId } : {}),
      ...(l.packageId ? { packageId: l.packageId } : {}),
      name: l.name,
      unitPrice: Number(l.unitPrice) / 100,
      quantity: Number(l.quantity),
    })),
    serviceIncluded: source?.serviceIncluded ?? r.serviceIncluded ?? r.settings?.defaultServiceIncluded ?? true,
    discountPercent: Number(totals.discountPercent ?? 0),
    deliveryFee: Number(totals.deliveryFee ?? 0) / 100,
    equipmentReturn,
    cleaningFee: savedFee > 0 ? savedFee : Number(r.settings?.cleaningFee ?? 0),
    message: source?.message ?? '',
    validUntil: source?.validUntil,
  }
}

/**
 * Momssatsen för offerten, bara för visning (servern räknar om när offerten
 * sparas): med servering 12 %; mat utan servering 6 % mellan 2026-04-01 och
 * 2027-12-31 (leveransdagen), annars 12 % (shared/catering.py vat_rate_for).
 */
export function vatRateFor(serviceIncluded: boolean, deliveryDate: string): number {
  if (serviceIncluded) return 12
  return deliveryDate >= '2026-04-01' && deliveryDate <= '2027-12-31' ? 6 : 12
}

/** Samma räkning som servern (shared/catering.py totals), i öre. */
export function offerTotals(offer: OfferInput, deliveryDate: string): Totals {
  const rate = vatRateFor(offer.serviceIncluded, deliveryDate)
  const subtotal = offer.lines.reduce((sum, l) => sum + Math.round(l.unitPrice * 100) * l.quantity, 0)
  const discount = Math.round((subtotal * offer.discountPercent) / 100)
  const cleaningFee = offer.equipmentReturn === 'not_cleaned' ? Math.round(offer.cleaningFee * 100) : 0
  const total = subtotal - discount + Math.round(offer.deliveryFee * 100) + cleaningFee
  return {
    subtotal,
    discountPercent: offer.discountPercent,
    discount,
    deliveryFee: Math.round(offer.deliveryFee * 100),
    cleaningFee,
    total,
    vat: Math.round((total * rate) / (100 + rate)),
    vatRate: rate,
  }
}

export function kronor(ore: number | undefined | null): string {
  const value = Number(ore ?? 0) / 100
  return `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: value % 1 ? 2 : 0, minimumFractionDigits: value % 1 ? 2 : 0 }).format(value)} kr`
}

const ERRORS: Record<string, string> = {
  dish_in_package: 'Rätten ingår i ett paket. Ta bort den ur paketet först.',
  changed_retry: 'Förfrågan har just ändrats (av kunden eller någon annan). Sidan är uppdaterad - försök igen.',
  capacity_full: 'Dagen är fullbokad för catering (max portioner per dag). Minska antalet eller tacka nej.',
  not_editable: 'Offerten kan inte ändras i den här statusen.',
  not_declinable: 'Förfrågan kan inte nekas i den här statusen.',
  not_cancellable: 'Beställningen kan inte avbokas i den här statusen.',
  not_confirmed: 'Bara bekräftade beställningar kan markeras som levererade.',
  payment_provider_rejected: 'Stripe nekade åtgärden. Kontrollera i Stripe och försök igen.',
  payment_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund.',
  signing_unavailable: 'Signeringstjänsten svarar inte just nu. Försök igen om en stund.',
  document_unavailable: 'Offerten kunde inte skapas som PDF just nu. Försök igen om en stund.',
  not_signable: 'Den här offertversionen kan inte signeras. Skicka offerten igen.',
  already_signed: 'Offerten är redan signerad av restaurangen.',
  signing_alreadyInProgress: 'En BankID-signering pågår redan. Avbryt den i appen och försök igen.',
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
