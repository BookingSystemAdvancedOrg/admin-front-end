import { apiFetch, ApiError } from '../../shared/api'

/**
 * Klient mot backendens /locations-endpoints (create-location/get-location).
 * Speglar valideringen i functions/create-location/app.py (dev-grenen):
 * alla sju veckodagar krävs, opensAt < closesAt, intervall får inte
 * överlappa, bookingDurationHours > 0, gracePeriodHours >= 0.
 *
 * `PUT /locations/{id}` är trots verbet en PARTIELL uppdatering: minst ett
 * fält krävs, och skickas `businessHours` måste alla sju veckodagar vara med.
 * Den kräver owner_user/super_user, till skillnad från läsningen.
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
  timezone: string
  businessHours: BusinessHours
  bookingDurationHours: number
  gracePeriodHours: number
}

export interface Location extends LocationCreateRequest {
  locationId: string
  createdBy: string
  createdAt: string
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/

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

/** Mappar API:ts { error: string } + statuskod till svenska meddelanden. */
function toFriendlyLocationError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Ett okänt fel inträffade.')
  }

  console.error(`[Locations] ${err.status}: ${err.message}`)

  switch (err.status) {
    case 400:
      return new Error(err.message)
    case 401:
      return new Error('Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new Error('Du har inte behörighet att göra detta.')
    case 404:
      return new Error('Platsen hittades inte.')
    case 409:
      return new Error('En plats med det ID:t finns redan — testa igen.')
    case 501:
      return new Error('Den här funktionen är inte klar på serversidan än.')
    case 503:
      return new Error('Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.')
    default:
      return new Error(err.message || `Serverfel (${err.status}).`)
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toFriendlyLocationError(err)
  }
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
