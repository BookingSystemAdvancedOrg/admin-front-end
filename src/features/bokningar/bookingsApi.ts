import { apiFetch, ApiError } from '../../shared/api'

/**
 * Klient mot bokningsrutterna (backend functions/mark-arrived,
 * create-pending-reservation, get-availability; docs/openapi.yaml).
 * Belopp kommer i öre från API:t.
 */

export type ReservationStatus =
  | 'pending'
  | 'reserved'
  | 'arrived'
  | 'no_show'
  | 'cancelled_no_charge'
  | 'cancelled_by_restaurant'
  | 'cancelled_charged'
  | 'cancelled_charge_failed'
  | 'no_show_charged'
  | 'no_show_charge_failed'
  | 'expired'

export type ReservationSource = 'online' | 'phone' | 'walk_in' | 'staff'

export interface ReservationPayment {
  kind?: 'no_show' | 'late_cancel'
  status?: 'pending' | 'processing' | 'succeeded' | 'failed' | 'refunded'
  amount?: number
  attempt?: number
  error?: string
  refundedAmount?: number
}

export interface GuaranteeSnapshot {
  currency?: string
  noShowFee?: number
  lateCancelFee?: number
  cancelCutoffHours?: number
}

export interface HistoryEntry {
  at?: string
  by?: string
  action?: string
  status?: string
  from?: string
  to?: string
  reason?: string
  [key: string]: unknown
}

export interface Reservation {
  reservationId: string
  locationId: string
  date: string
  startTime: string
  endTime: string
  bookedFor?: string
  endsAt?: string
  timezone?: string
  tableIds: string[]
  seats?: number
  partySize: number
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  notes?: string
  language?: 'sv' | 'en'
  source?: ReservationSource
  status: ReservationStatus
  createdAt?: string
  history?: HistoryEntry[]
  cardOnFile?: boolean
  guarantee?: GuaranteeSnapshot
  payment?: ReservationPayment
  pendingExpiresAt?: string
}

export interface AvailabilitySlot {
  startTime: string
  endTime: string
  layoutVersion: number
  tables: { tableId: string; seats: number }[]
}

export interface ManualReservationInput {
  date: string
  startTime: string
  tableIds: string[]
  partySize: number
  name: string
  email?: string
  phone?: string
  notes?: string
  language?: 'sv' | 'en'
  source: 'phone' | 'walk_in' | 'staff'
  notifyGuest?: boolean
}

export interface ReservationEdit {
  date?: string
  startTime?: string
  tableIds?: string[]
  partySize?: number
  name?: string
  email?: string | null
  phone?: string | null
  notes?: string | null
  notifyGuest?: boolean
}

export type StatusAction = 'arrived' | 'reserved' | 'no_show' | 'cancelled'

// --- labels -----------------------------------------------------------------

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: 'Väntar på kort',
  reserved: 'Bokad',
  arrived: 'Anlänt',
  no_show: 'Uteblev',
  cancelled_no_charge: 'Avbokad av gäst',
  cancelled_by_restaurant: 'Avbokad av er',
  cancelled_charged: 'Sen avbokning (debiterad)',
  cancelled_charge_failed: 'Sen avbokning (debitering misslyckades)',
  no_show_charged: 'Uteblev (debiterad)',
  no_show_charge_failed: 'Uteblev (debitering misslyckades)',
  expired: 'Kort ej lagt in',
}

/** CSS-klass för status-badge (shared/admin.css). */
export const STATUS_CLASS: Record<ReservationStatus, string> = {
  pending: 'waiting',
  reserved: 'reserved',
  arrived: 'arrived',
  no_show: 'noshow',
  cancelled_no_charge: 'cancelled-free',
  cancelled_by_restaurant: 'cancelled-free',
  cancelled_charged: 'cancelled-charged',
  cancelled_charge_failed: 'noshow',
  no_show_charged: 'noshow',
  no_show_charge_failed: 'noshow',
  expired: 'cancelled-free',
}

export const SOURCE_LABEL: Record<ReservationSource, string> = {
  online: 'Online',
  phone: 'Telefon',
  walk_in: 'Drop-in',
  staff: 'Personal',
}

/** Bokningar som tar plats i salen (räknas i dagens summering). */
export const ACTIVE_STATUSES: ReservationStatus[] = ['pending', 'reserved', 'arrived']

const CANCELLED: ReservationStatus[] = [
  'cancelled_no_charge',
  'cancelled_by_restaurant',
  'cancelled_charged',
  'cancelled_charge_failed',
  'expired',
]

export function isCancelled(status: ReservationStatus): boolean {
  return CANCELLED.includes(status)
}

/** "250 kr" / "1 234,50 kr" från öre. */
export function formatKr(ore: number | undefined | null): string {
  const kr = (ore ?? 0) / 100
  return `${kr.toLocaleString('sv-SE', {
    minimumFractionDigits: Number.isInteger(kr) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`
}

export function tablesLabel(ids: string[]): string {
  if (ids.length === 0) return '—'
  return `Bord ${ids.join(', ')}`
}

/** Vad bokningens avgift gäller just nu (för listan), eller null. */
export function feeSummary(r: Reservation): string | null {
  const p = r.payment
  if (!p?.amount) return null
  const refunded = p.refundedAmount ?? 0
  if (p.status === 'succeeded' || p.status === 'refunded') {
    return refunded > 0
      ? `${formatKr(p.amount)} (återbetalt ${formatKr(refunded)})`
      : formatKr(p.amount)
  }
  if (p.status === 'failed') return `${formatKr(p.amount)} misslyckades`
  return `${formatKr(p.amount)} pågår`
}

/** Vilka handlingar personalen kan erbjudas för en bokning. Servern har
 * sista ordet (tidsfönster, grace period) - ett nej visas som fel. */
export function availableActions(r: Reservation, isOwner: boolean) {
  const p = r.payment
  const charged = r.status === 'no_show_charged' || r.status === 'cancelled_charged'
  const remaining = (p?.amount ?? 0) - (p?.refundedAmount ?? 0)
  return {
    arrive: r.status === 'reserved' || r.status === 'no_show',
    undoArrive: r.status === 'arrived',
    noShow: r.status === 'reserved',
    cancel: r.status === 'reserved',
    edit: r.status === 'reserved' || r.status === 'arrived',
    retryCharge:
      r.status === 'no_show_charge_failed' ||
      r.status === 'cancelled_charge_failed' ||
      (r.status === 'no_show' && Boolean(r.guarantee?.noShowFee) && Boolean(r.cardOnFile)),
    refund: isOwner && charged && p?.status === 'succeeded' && remaining > 0,
    refundable: charged && p?.status === 'succeeded' ? remaining : 0,
  }
}

// --- errors -------------------------------------------------------------------

const ERROR_TEXT: Record<string, string> = {
  too_early: 'Gästen kan markeras som anländ tidigast 3 timmar före bokningen.',
  already_ended: 'Bokningen har redan passerat.',
  not_arrivable: 'Den här bokningen kan inte markeras som anländ.',
  cannot_undo: 'Det går inte att ångra längre.',
  not_reserved: 'Bara en aktiv bokning kan markeras som utebliven.',
  grace_period_not_over:
    'För tidigt: gästen kan markeras som utebliven först när platsens grace period efter starttiden har gått.',
  not_cancellable: 'Den här bokningen kan inte avbokas.',
  not_movable: 'Den här bokningen kan inte flyttas.',
  not_editable: 'Den här bokningen kan inte ändras.',
  table_taken: 'Bordet har hunnit bokas. Välj ett annat bord eller en annan tid.',
  no_fee: 'Det finns ingen avgift att debitera på den här bokningen.',
  not_chargeable: 'Den här bokningen kan inte debiteras.',
  not_refundable: 'Det finns inget att återbetala.',
  owner_only: 'Bara restaurangens ägare kan göra återbetalningar.',
  payment_unavailable: 'Stripe svarar inte just nu. Försök igen om en stund - inget dras två gånger.',
  card_declined: 'Kortet nekades.',
  authentication_required:
    'Gästens bank kräver att gästen godkänner betalningen. Kontakta gästen och lös avgiften direkt.',
  insufficient_funds: 'Det finns inte tillräckligt med pengar på kortet.',
  expired_card: 'Kortet har gått ut.',
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const known = ERROR_TEXT[err.message]
    if (known) return known
    if (err.status === 402) return `Betalningen gick inte igenom (${err.message}).`
    if (err.status === 400) return err.message
    if (err.status === 403) return 'Du har inte behörighet att göra detta.'
    if (err.status === 404) return 'Bokningen hittades inte - den kan ha tagits bort.'
    if (err.status === 401) return 'Du är inte inloggad längre. Logga in igen.'
  }
  return 'Något gick fel. Försök igen om en stund.'
}

// --- calls --------------------------------------------------------------------

const base = (locationId: string) => `/locations/${encodeURIComponent(locationId)}`

export async function listReservations(locationId: string, date: string): Promise<Reservation[]> {
  const res = await apiFetch<{ items?: Reservation[] }>(
    `${base(locationId)}/reservations?date=${encodeURIComponent(date)}`,
  )
  return res.items ?? []
}

export function getReservation(locationId: string, id: string): Promise<Reservation> {
  return apiFetch<Reservation>(`${base(locationId)}/reservations/${encodeURIComponent(id)}`)
}

export function createManualReservation(
  locationId: string,
  input: ManualReservationInput,
): Promise<Reservation> {
  return apiFetch<Reservation>(`${base(locationId)}/reservations/manual`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateReservation(
  locationId: string,
  id: string,
  edit: ReservationEdit,
): Promise<Reservation> {
  return apiFetch<Reservation>(`${base(locationId)}/reservations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(edit),
  })
}

export function changeStatus(
  locationId: string,
  id: string,
  status: StatusAction,
  options: { reason?: string; chargeFee?: boolean; notifyGuest?: boolean } = {},
): Promise<Reservation> {
  return apiFetch<Reservation>(
    `${base(locationId)}/reservations/${encodeURIComponent(id)}/status`,
    { method: 'POST', body: JSON.stringify({ status, ...options }) },
  )
}

export function paymentAction(
  locationId: string,
  id: string,
  action: 'charge' | 'refund',
  amount?: number,
): Promise<Reservation> {
  return apiFetch<Reservation>(
    `${base(locationId)}/reservations/${encodeURIComponent(id)}/payment`,
    { method: 'POST', body: JSON.stringify(amount ? { action, amount } : { action }) },
  )
}

/** Lediga tider. `walkIn` tar även med pågående tider och de inom
 * 30-minutersgränsen (gästen står redan i restaurangen). */
export async function getAvailability(
  locationId: string,
  date: string,
  { walkIn = false }: { walkIn?: boolean } = {},
): Promise<AvailabilitySlot[]> {
  const res = await apiFetch<{ slots?: AvailabilitySlot[] }>(
    `${base(locationId)}/availability?date=${encodeURIComponent(date)}${walkIn ? '&walkIn=true' : ''}`,
  )
  return res.slots ?? []
}

// --- dates --------------------------------------------------------------------

/** Dagens datum (YYYY-MM-DD) i platsens tidszon. */
export function todayIn(timezone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone || 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** "Måndag 12 oktober" */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const s = new Intl.DateTimeFormat('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "12 okt 18:04" för historik/tidsstämplar. */
export function timestampLabel(iso: string | undefined, timezone?: string | null): string {
  if (!iso) return ''
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone || 'Europe/Stockholm',
  }).format(dt)
}
