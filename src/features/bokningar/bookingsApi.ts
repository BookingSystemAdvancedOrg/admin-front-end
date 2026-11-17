import { errorText } from '../../shared/errors'
import { apiFetch, ApiError, isApiConfigured } from '../../shared/api'

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
  /** Bokningstidsregeln bokningen fick (äldre bokningar: egen längd, ej förlängbar). */
  bookingRule?: BookingRule
  /** Minuter personalen förlängt utöver regelns längd (0 när den inte förlängts eller kortats). */
  extendedMinutes?: number
}

export interface BookingRule {
  windowId?: string
  name?: string
  durationMinutes: number
  extensionAllowed: boolean
  maxExtensionMinutes: number
}

export interface AvailabilitySlot {
  startTime: string
  endTime: string
  durationMinutes?: number
  extendable?: boolean
  ruleName?: string | null
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
  /** Förläng/korta (skickas ensamt). */
  endTime?: string
  /** Personalen förlänger utöver regeln (loggas). */
  overrideRule?: boolean
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
  cancelled_charge_failed: 'Sen avbokning (avgiften drogs inte)',
  no_show_charged: 'Uteblev (debiterad)',
  no_show_charge_failed: 'Uteblev (avgiften drogs inte)',
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
  if (p.status === 'failed') return `${formatKr(p.amount)} drogs inte`
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
    extend: r.status === 'reserved' || r.status === 'arrived',
    retryCharge:
      r.status === 'no_show_charge_failed' ||
      r.status === 'cancelled_charge_failed' ||
      (r.status === 'no_show' && Boolean(r.guarantee?.noShowFee) && Boolean(r.cardOnFile)),
    refund: isOwner && charged && p?.status === 'succeeded' && remaining > 0,
    refundable: charged && p?.status === 'succeeded' ? remaining : 0,
  }
}

// --- guest fields (same rules as the server: shared/reservations.py) ----------

export const NAME_MAX = 100
export const EMAIL_MAX = 254
export const NOTES_MAX = 500
const E164 = /^\+[1-9]\d{7,14}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Telefonnummer i E.164 som servern sparar det (070-123 45 67 ->
 * +46701234567, 0046… -> +46…), eller null om det inte går att tolka.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.trim().replace(/[\s\-.]/g, '')
  digits = digits.replace(/^(\+\d{1,3})\(0\)/, '$1').replace(/[()]/g, '')
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`
  else if (digits.startsWith('0')) digits = `+46${digits.slice(1)}`
  return E164.test(digits) ? digits : null
}

export function validEmail(raw: string): boolean {
  const email = raw.trim()
  return email.length <= EMAIL_MAX && EMAIL.test(email)
}

// --- errors -------------------------------------------------------------------

const ERROR_TEXT: Record<string, string> = {
  too_early: 'Det är för tidigt. Gästen kan markeras som anländ tidigast 3 timmar före bokningen.',
  already_ended: 'Bokningen är redan över. Den kan inte ändras längre.',
  not_arrivable: 'Den här bokningen kan inte markeras som anländ. Kolla bokningens läge i listan.',
  cannot_undo: 'Det har gått för lång tid, så det går inte att ångra längre.',
  not_reserved: 'Bara en bokning som fortfarande gäller kan markeras som utebliven.',
  grace_period_not_over:
    'Det är för tidigt. Vänta tills tiden för sena gäster har gått, sedan kan gästen markeras som utebliven.',
  not_cancellable: 'Den här bokningen kan inte avbokas längre. Nu syns det senaste.',
  not_movable: 'Den här bokningen kan inte flyttas längre. Nu syns det senaste.',
  not_editable: 'Den här bokningen kan inte ändras längre. Nu syns det senaste.',
  table_taken: 'Någon hann boka bordet. Välj ett annat bord eller en annan tid.',
  no_fee: 'Den här bokningen har ingen avgift att ta betalt för.',
  not_chargeable: 'Det går inte att ta betalt för den här bokningen. Lös avgiften direkt med gästen.',
  not_refundable: 'Det finns inget att betala tillbaka på den här bokningen.',
  owner_only: 'Bara restaurangens ägare kan betala tillbaka. Be ägaren göra det.',
  payment_unavailable: 'Stripe svarar inte just nu, och inget dras två gånger. Det är inte ert fel. Försök igen om en stund, eller rapportera det till Booqy.',
  card_declined: 'Gästens kort sa nej. Be gästen betala på ett annat sätt.',
  authentication_required:
    'Gästens bank vill att gästen godkänner betalningen. Kontakta gästen och lös avgiften direkt.',
  insufficient_funds: 'Det finns inte tillräckligt med pengar på gästens kort. Lös avgiften direkt med gästen.',
  expired_card: 'Gästens kort har gått ut. Lös avgiften direkt med gästen.',
  not_extendable: 'Den här sortens bokning får inte förlängas.',
  extension_too_long: 'Det är längre än bokningen får förlängas.',
  window_not_extendable: 'Förlängningen går in i en tid som inte får förlängas, till exempel en buffé.',
  after_closing: 'Bokningen kan inte sluta efter stängningstid. Välj en tidigare sluttid.',
}

/** Stripes felkod för en avgift som inte gick igenom, som kort etikett.
 * Okända koder visas inte (de är tekniska och på engelska). */
const PAYMENT_FAILURE_LABEL: Record<string, string> = {
  card_declined: 'kortet nekades',
  // Stripe-webhooken sparar decline_code före code.
  generic_decline: 'kortet nekades',
  do_not_honor: 'kortet nekades',
  lost_card: 'kortet nekades',
  stolen_card: 'kortet nekades',
  pickup_card: 'kortet nekades',
  fraudulent: 'kortet nekades',
  card_velocity_exceeded: 'kortet nekades',
  incorrect_cvc: 'kortet nekades',
  processing_error: 'tillfälligt fel hos kortbolaget',
  insufficient_funds: 'för lite pengar på kortet',
  expired_card: 'kortet har gått ut',
  authentication_required: 'gästen behöver godkänna',
}

export function paymentFailureLabel(code: unknown): string {
  return typeof code === 'string' ? (PAYMENT_FAILURE_LABEL[code] ?? '') : ''
}

/** Svar där personalen kan välja att förlänga ändå (loggas). */
export const OVERRIDABLE = ['not_extendable', 'extension_too_long', 'window_not_extendable']

/** Valideringsfel (400) från servern, i den ordning de ska matchas. */
const VALIDATION_TEXT: [RegExp, string][] = [
  [/^startTime is not a bookable time/,
    'Den tiden går inte att boka längre. Välj en annan tid i listan.'],
  [/^tableIds contains a table that isn't bookable/,
    'Ett av borden är inte ledigt den tiden längre. Välj bord igen.'],
  [/^the selected tables seat (\d+)/, 'Borden du valt har för få platser för sällskapet. Välj fler bord.'],
  [/^a walk-in is booked for today/, 'En drop-in gäller alltid idag. Välj dagens datum.'],
  [/^a walk-in stays on its day/, 'En drop-in kan inte flyttas till en annan dag. Gör en ny bokning i stället.'],
  [/^date must not be in the past/, 'Datumet har redan varit. Välj idag eller en senare dag.'],
  [/^date must not be more than 21 days ahead/, 'Det går bara att boka 21 dagar fram. Välj ett tidigare datum.'],
  [/^phone must be a valid/, 'Telefonnumret ser fel ut. Skriv det så här: 070 123 45 67.'],
  [/^(email|phone) is required/, 'En onlinebokning behöver både e-post och telefon. Fyll i båda.'],
  [/^email must be a valid/, 'E-postadressen ser fel ut. Skriv den så här: namn@exempel.se.'],
  [/^name is required/, 'Gästens namn saknas. Skriv till exempel Anna Svensson.'],
  [/^name must be at most/, `Namnet är för långt. Använd högst ${NAME_MAX} tecken.`],
  [/^email must be at most/, `E-postadressen är för lång. Använd högst ${EMAIL_MAX} tecken.`],
  [/^notes must be at most/, `Anteckningen är för lång. Använd högst ${NOTES_MAX} tecken.`],
  [/^partySize must be/, 'Antal personer ska vara ett helt tal från 1 till 50, till exempel 4.'],
  [/^tableIds must be a non-empty list/, 'Inget bord är valt. Välj minst ett bord.'],
  [/^tableIds must /, 'Borden behöver väljas om. Välj bord i listan igen.'],
  [/^at most \d+ tables per booking/, 'Det är för många bord. Välj högst 6 bord per bokning.'],
  [/^endTime falls on a clock change/, 'Sluttiden hamnar när klockan ställs om. Välj en annan sluttid.'],
  [/^endTime must be/, 'Sluttiden går inte. Välj en tid i kvartar, minst 15 minuter efter start, till exempel 20:15.'],
]

/** 404 från en bokning (ändra, status, betalning): bokningen finns inte längre. */
export const RESERVATION_NOT_FOUND = 'Bokningen finns inte längre, någon har tagit bort den. Nu syns det som finns kvar.'

/** 404 från platsens bokningsrutter (lediga tider, ny bokning, listan): det
 * är platsen, inte en bokning, som saknas eller inte tar emot bokningar. */
export const LOCATION_NOT_BOOKABLE =
  'Restaurangen tar inte emot bokningar just nu. Ägaren kan kolla att bokning ingår i abonnemanget.'

export function errorMessage(
  err: unknown,
  action = 'Bokningen sparades inte.',
  notFound: string = RESERVATION_NOT_FOUND,
): string {
  if (err instanceof ApiError) {
    // Via errorText så felrutan vet vem som gör något (Stripe nere: Försök igen).
    if (ERROR_TEXT[err.message]) return errorText(err, action, { [err.code]: ERROR_TEXT[err.message] })
    if (err.status === 402) return 'Betalningen gick inte igenom. Be gästen använda ett annat kort, eller lös avgiften direkt med gästen.'
    if (err.status === 400) {
      const match = VALIDATION_TEXT.find(([pattern]) => pattern.test(err.message))
      if (match) return match[1]
    }
    if (err.status === 404 && err.code !== 'route_not_found') return notFound
  }
  return errorText(err, action)
}

/** Tiden eller bordet gick inte längre (tiden passerade 30-minutersgränsen
 * eller någon hann före) - listan med lediga tider behöver hämtas om. */
export function isStaleSlotError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.message === 'table_taken' ||
      (err.status === 400 &&
        (/^startTime is not a bookable time/.test(err.message) ||
          /^tableIds contains a table that isn't bookable/.test(err.message))))
  )
}

// --- calls --------------------------------------------------------------------

const base = (locationId: string) => `/locations/${encodeURIComponent(locationId)}`

/** Plats-id för exempeldatan när admin körs utan API. */
export const MOCK_LOCATION_ID = 'mock'

/** Utan API: en kväll med några bokningar i olika lägen (samma lista varje dag). */
export function mockReservations(date: string): Reservation[] {
  const r = (
    id: string,
    startTime: string,
    endTime: string,
    partySize: number,
    tableIds: string[],
    status: ReservationStatus,
    extra: Partial<Reservation> = {},
  ): Reservation => ({
    reservationId: `mockres${id}`,
    locationId: MOCK_LOCATION_ID,
    date,
    startTime,
    endTime,
    partySize,
    tableIds,
    status,
    timezone: 'Europe/Stockholm',
    source: 'online',
    ...extra,
  })
  return [
    r('1', '17:00', '19:00', 2, ['3'], 'arrived', { customerName: 'Åsa Öberg', customerPhone: '070-123 45 67' }),
    r('2', '17:30', '19:30', 4, ['7'], 'reserved', {
      customerName: 'Johan Lind',
      notes: 'Barnstol, en glutenfri',
      cardOnFile: true,
    }),
    r('3', '18:00', '20:00', 6, ['9', '10'], 'reserved', { customerName: 'Sara Ek', source: 'phone' }),
    r('4', '19:00', '21:00', 2, ['4'], 'reserved', { customerName: 'Erik Holm', source: 'walk_in' }),
    r('5', '19:30', '21:30', 3, ['5'], 'cancelled_no_charge', { customerName: 'Lina Berg' }),
  ]
}

export async function listReservations(locationId: string, date: string): Promise<Reservation[]> {
  if (!isApiConfigured()) return mockReservations(date)
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
  refund?: { amount?: number; reason?: string; notifyGuest?: boolean },
): Promise<Reservation> {
  return apiFetch<Reservation>(
    `${base(locationId)}/reservations/${encodeURIComponent(id)}/payment`,
    { method: 'POST', body: JSON.stringify({ action, ...(action === 'refund' ? refund : {}) }) },
  )
}

/** Lediga tider. `walkIn` tar även med pågående tider och de inom
 * 30-minutersgränsen (gästen står redan i restaurangen). */
/** En avvikande dag (stängt, andra tider, ingen onlinebokning). */
export interface DayStatus {
  kind: 'closed' | 'hours' | 'no_online'
  intervals?: { opensAt: string; closesAt: string }[]
  note?: string
}

export interface AvailabilityResult {
  slots: AvailabilitySlot[]
  /** Satt bara på en avvikande dag. */
  day: DayStatus | null
}

export async function getAvailability(
  locationId: string,
  date: string,
  { walkIn = false }: { walkIn?: boolean } = {},
): Promise<AvailabilityResult> {
  const res = await apiFetch<{ slots?: AvailabilitySlot[]; day?: DayStatus }>(
    `${base(locationId)}/availability?date=${encodeURIComponent(date)}${walkIn ? '&walkIn=true' : ''}`,
  )
  return { slots: res.slots ?? [], day: res.day ?? null }
}

/** Personalens rad om en avvikande dag, eller null. */
export function dayNotice(day: DayStatus | null): string | null {
  if (!day) return null
  const note = day.note ? ` (${day.note})` : ''
  if (day.kind === 'closed') return `Restaurangen är stängd den dagen${note}.`
  if (day.kind === 'hours') {
    const hours = (day.intervals ?? []).map((i) => `${i.opensAt}-${i.closesAt}`).join(', ')
    return `Avvikande öppettider den dagen: ${hours}${note}.`
  }
  return `Onlinebokningen är stängd den dagen${note} - här kan du ändå boka.`
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
