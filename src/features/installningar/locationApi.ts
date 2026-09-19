import { apiFetch, ApiError } from '../../shared/api'

/**
 * Klient mot backendens /locations-endpoints (create-location/get-location).
 * Speglar valideringen i functions/create-location/app.py (dev-grenen):
 * alla sju veckodagar krävs, opensAt < closesAt, intervall får inte
 * överlappa, bookingDurationHours > 0, gracePeriodHours >= 0, email/
 * phoneNumber krävs vid skapande (se openapi.yaml på localhost:8081).
 *
 * `PUT /locations/{id}` är trots verbet en PARTIELL uppdatering: minst ett
 * fält krävs, och skickas `businessHours` måste alla sju veckodagar vara med.
 * Kontaktfälten är valfria vid uppdatering, men på en äldre plats som helt
 * saknar dem måste den första kontaktuppdateringen skicka BÅDA — därför
 * skickar locationChanges() alltid email och phoneNumber ihop. Den kräver
 * owner_user/super_user, till skillnad från läsningen.
 */

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type Weekday = (typeof WEEKDAYS)[number]

export interface BusinessHoursInterval {
  opensAt: string
  closesAt: string
}

export type BusinessHours = Record<Weekday, BusinessHoursInterval[]>

export interface LocationCreateRequest {
  name: string
  address: string
  email: string
  phoneNumber: string
  timezone: string
  businessHours: BusinessHours
  bookingDurationHours: number
  gracePeriodHours: number
}

export interface Location
  extends Omit<LocationCreateRequest, 'email' | 'phoneNumber'> {
  locationId: string
  createdBy: string
  createdAt: string
  /** Saknas bara på äldre platser som skapades innan kontaktfälten fanns. */
  email?: string
  phoneNumber?: string
  /** Sätts av API:t vid en faktisk ändring; en no-op PUT lämnar dem orörda. */
  updatedBy?: string
  updatedAt?: string
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

export function emptyBusinessHours(): BusinessHours {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  }
}

export function validateName(name: string): string | null {
  return name.trim() ? null : 'Namn krävs.'
}

export function validateAddress(address: string): string | null {
  return address.trim() ? null : 'Adress krävs.'
}

export function validateEmail(email: string): string | null {
  return EMAIL_PATTERN.test(email.trim()) ? null : 'Ange en giltig e-postadress.'
}

export function validatePhoneNumber(phone: string): string | null {
  return PHONE_PATTERN.test(phone.trim())
    ? null
    : 'Ange telefonnummer i internationellt format, t.ex. +46701234567.'
}

export function validateTimezone(timezone: string): string | null {
  // Fullständig IANA-validering (som Pythons zoneinfo) görs på servern - här
  // stoppar vi bara tomma/uppenbart trasiga värden innan ett onödigt anrop.
  return timezone.trim() ? null : 'Tidszon krävs.'
}

export function validateBookingDuration(hours: number): string | null {
  if (!Number.isFinite(hours) || hours <= 0) {
    return 'Bokningslängd måste vara större än noll.'
  }
  return null
}

export function validateGracePeriod(hours: number): string | null {
  if (!Number.isFinite(hours) || hours < 0) {
    return 'Grace period kan inte vara negativ.'
  }
  return null
}

/** Validerar en dags intervall: giltig tid, opensAt < closesAt, inget överlapp. */
export function validateDayIntervals(
  day: Weekday,
  intervals: BusinessHoursInterval[],
): string | null {
  for (const { opensAt, closesAt } of intervals) {
    if (!TIME_PATTERN.test(opensAt) || !TIME_PATTERN.test(closesAt)) {
      return `${day}: tiderna måste anges som TT:MM.`
    }
    if (opensAt >= closesAt) {
      return `${day}: öppningstiden måste vara före stängningstiden.`
    }
  }
  const sorted = [...intervals].sort((a, b) => a.opensAt.localeCompare(b.opensAt))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].closesAt > sorted[i].opensAt) {
      return `${day}: tiderna får inte överlappa varandra.`
    }
  }
  return null
}

export function validateBusinessHours(hours: BusinessHours): string | null {
  for (const day of WEEKDAYS) {
    const error = validateDayIntervals(day, hours[day])
    if (error) return error
  }
  return null
}

/**
 * Mappar API:ts { error: string } + statuskod till svenska meddelanden.
 * Statuskoden bevaras (felet förblir en ApiError) så att anropare kan
 * reagera på t.ex. 404 — "platsen finns inte" är ett tillstånd att hantera,
 * inte bara en text att visa (se location.ts som rensar döda id:n).
 */
function toFriendlyLocationError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Ett okänt fel inträffade.')
  }

  console.error(`[Locations] ${err.status}: ${err.message}`)

  switch (err.status) {
    case 400:
      return new ApiError(400, err.message)
    case 401:
      return new ApiError(401, 'Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new ApiError(403, 'Du har inte behörighet att göra detta.')
    case 404:
      return new ApiError(404, 'Platsen hittades inte.')
    case 409:
      return new ApiError(409, 'En plats med det ID:t finns redan — testa igen.')
    case 501:
      return new ApiError(501, 'Den här funktionen är inte klar på serversidan än.')
    case 503:
      return new ApiError(
        503,
        'Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.',
      )
    default:
      return new ApiError(err.status, err.message || `Serverfel (${err.status}).`)
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toFriendlyLocationError(err)
  }
}

/**
 * GET /locations — hela platskatalogen. Kräver owner_user/super_user, så
 * personal får 403 här och måste hitta sin plats på annat sätt.
 *
 * Systemet driftsätts med en instans per kund, så listan innehåller i
 * praktiken exakt en plats: restaurangen det här systemet tillhör.
 */
export function listLocations(): Promise<Location[]> {
  return call(async () => {
    const res = await apiFetch<{ items?: Location[] }>('/locations')
    return res.items ?? []
  })
}

export function createLocation(input: LocationCreateRequest): Promise<Location> {
  return call(() =>
    apiFetch<Location>('/locations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
}

export function getLocation(locationId: string): Promise<Location> {
  return call(() =>
    apiFetch<Location>(`/locations/${encodeURIComponent(locationId)}`),
  )
}

/** Partiell uppdatering — skicka bara de fält som faktiskt ändrats. */
export type LocationUpdate = Partial<LocationCreateRequest>

export function updateLocation(
  locationId: string,
  updates: LocationUpdate,
): Promise<Location> {
  return call(() =>
    apiFetch<Location>(`/locations/${encodeURIComponent(locationId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  )
}

/**
 * Räknar ut vilka fält som skiljer sig mot den sparade platsen. API:t kräver
 * minst ett fält, så en tom diff ska aldrig skickas — anroparen kan skilja
 * "inget ändrat" från ett riktigt anrop.
 */
export function locationChanges(
  original: LocationCreateRequest,
  next: LocationCreateRequest,
): LocationUpdate {
  const updates: LocationUpdate = {}
  if (original.name !== next.name) updates.name = next.name
  if (original.address !== next.address) updates.address = next.address
  // Servern kräver båda kontaktfälten tillsammans så fort ett av dem skickas
  // (annars kan en äldre plats utan kontaktuppgifter inte uppdateras) — så
  // de diffas och skickas alltid ihop, aldrig var för sig.
  if (original.email !== next.email || original.phoneNumber !== next.phoneNumber) {
    updates.email = next.email
    updates.phoneNumber = next.phoneNumber
  }
  if (original.timezone !== next.timezone) updates.timezone = next.timezone
  if (original.bookingDurationHours !== next.bookingDurationHours) {
    updates.bookingDurationHours = next.bookingDurationHours
  }
  if (original.gracePeriodHours !== next.gracePeriodHours) {
    updates.gracePeriodHours = next.gracePeriodHours
  }
  if (
    JSON.stringify(original.businessHours) !== JSON.stringify(next.businessHours)
  ) {
    updates.businessHours = next.businessHours
  }
  return updates
}
