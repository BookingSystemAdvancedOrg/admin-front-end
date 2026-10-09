import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../features/auth/useAuth'
import { ApiError, apiFetch, isApiConfigured } from './api'

/**
 * Den inloggade restaurangen (tenant) — GET /tenant.
 *
 * Systemet är multi-tenant: EN deployment betjänar alla restauranger, och
 * vilken restaurang anropet gäller avgörs av servern ur access-tokenen
 * (`tenant_id`-claimet). Appen skickar aldrig något tenant-id själv.
 *
 * GET /tenant är appens startpunkt: restaurangens namn, plan, Stripe-status
 * och de platser den inloggade får arbeta med (ägare: alla restaurangens,
 * personal: bara sin egen). Allt annat (vald plats, sidebar, inställningar)
 * bygger på det här svaret.
 */

export type TenantRole = 'owner_user' | 'staff_user'

export interface TenantLocation {
  locationId: string
  name: string | null
  address: string | null
  timezone: string | null
}

export interface TenantStripeStatus {
  /** Ett Stripe-konto finns (skapas av plattformen vid registreringen). */
  connected: boolean
  /** Kortbetalningar kan tas emot. */
  chargesEnabled: boolean
  /** Utbetalningar till restaurangens bankkonto är aktiva. */
  payoutsEnabled: boolean
  /** Restaurangen har skickat in sina uppgifter till Stripe. */
  detailsSubmitted: boolean
}

export interface Tenant {
  tenantId: string
  name: string
  slug: string | null
  status: 'active'
  planId: string | null
  entitlements: {
    maxLocations: number | null
    features: Record<string, boolean>
  }
  locationCount: number
  stripe: TenantStripeStatus
  primaryDomain: string | null
  senderName: string | null
  replyToEmail: string | null
  role: TenantRole
  locations: TenantLocation[]
}

/** Var restaurangen är i Stripe-flödet. */
export type StripeStage = 'missing' | 'not_started' | 'in_review' | 'ready'

export function stripeStage(stripe: TenantStripeStatus): StripeStage {
  if (!stripe.connected) return 'missing'
  if (stripe.chargesEnabled) return 'ready'
  if (stripe.detailsSubmitted) return 'in_review'
  return 'not_started'
}

export function getTenant(): Promise<Tenant> {
  return apiFetch<Tenant>('/tenant')
}

/**
 * POST /tenant/stripe/account-link — en engångslänk (giltig några minuter)
 * till Stripes egen onboarding för restaurangens konto. Bara ägare.
 * 409 `no_stripe_account` = plattformen har inte skapat kontot än.
 */
export function createStripeAccountLink(): Promise<{
  url: string
  expiresAt?: string
}> {
  return apiFetch('/tenant/stripe/account-link', { method: 'POST' })
}

/**
 * Lokalt utan backend (`VITE_API_BASE_URL` osatt, mock-inloggning): en tydligt
 * påhittad restaurang utan platser, så skalet går att utveckla. Används
 * ALDRIG när API:t är konfigurerat.
 */
const LOCAL_DEMO_TENANT: Tenant = {
  tenantId: 'local-demo',
  name: 'Demo (lokal utveckling)',
  slug: null,
  status: 'active',
  planId: null,
  entitlements: { maxLocations: null, features: {} },
  locationCount: 0,
  stripe: {
    connected: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  },
  primaryDomain: null,
  senderName: null,
  replyToEmail: null,
  role: 'owner_user',
  locations: [],
}

// --- Store ------------------------------------------------------------------
//
// En enda kopia per flik, delad av alla komponenter (sidebar, topbar, sidor)
// via useSyncExternalStore — ett platsbyte i sidebaren syns överallt direkt.
// Bunden till inloggningens `sub`: en annan användare (utloggning/inloggning
// i samma flik) får aldrig se föregående användares restaurang.

export type TenantErrorCode =
  | 'tenant_inactive'
  | 'no_tenant'
  | 'unauthorized'
  | 'unavailable'

export interface TenantState {
  /** Vems data det här är; null = ingen inloggning laddad. */
  sub: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  tenant: Tenant | null
  error: TenantErrorCode | null
  /** Platsen appen arbetar med just nu (alltid en av tenant.locations). */
  locationId: string | null
}

const INITIAL: TenantState = {
  sub: null,
  status: 'idle',
  tenant: null,
  error: null,
  locationId: null,
}

let state: TenantState = INITIAL
let inflight: Promise<Tenant | null> | null = null
const listeners = new Set<() => void>()

function setState(next: Partial<TenantState>): void {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTenantState(): TenantState {
  return state
}

/** Glömmer allt — anropas vid utloggning. */
export function resetTenantStore(): void {
  inflight = null
  state = INITIAL
  listeners.forEach((l) => l())
}

// Vald plats minns per restaurang, så en delad dator aldrig bär med sig en
// annan restaurangs plats-id. Den gamla, globala nyckeln städas bort.
const LEGACY_LOCATION_KEY = 'admin-location-id'
const locationKey = (tenantId: string) => `admin-location-id:${tenantId}`

function readStoredLocation(tenantId: string): string | null {
  try {
    localStorage.removeItem(LEGACY_LOCATION_KEY)
    return localStorage.getItem(locationKey(tenantId))
  } catch {
    return null
  }
}

function writeStoredLocation(tenantId: string, locationId: string): void {
  try {
    localStorage.setItem(locationKey(tenantId), locationId)
  } catch {
    // Avstängd lagring ska inte stoppa platsbytet.
  }
}

/**
 * Vilken plats som gäller: den senast valda om den fortfarande är en av
 * restaurangens (servern är facit), annars den äldsta (listan kommer
 * sorterad från servern, så alla enheter landar på samma).
 */
export function pickLocation(
  tenant: Tenant,
  preferred: string | null,
): string | null {
  const ids = tenant.locations.map((l) => l.locationId)
  if (preferred && ids.includes(preferred)) return preferred
  return ids[0] ?? null
}

function errorCode(err: unknown): TenantErrorCode {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'unauthorized'
    if (err.status === 403 && err.message === 'tenant_inactive') {
      return 'tenant_inactive'
    }
    if (err.status === 403) return 'no_tenant'
  }
  return 'unavailable'
}

/**
 * Hämtar (eller återanvänder) restaurangen för `sub`. `force` hämtar om
 * — t.ex. efter att en plats skapats eller Stripe-onboardingen avslutats.
 */
export function loadTenant(
  sub: string | null,
  { force = false }: { force?: boolean } = {},
): Promise<Tenant | null> {
  if (state.sub !== sub) {
    inflight = null
    state = { ...INITIAL, sub }
  }
  if (!force && state.status === 'ready') return Promise.resolve(state.tenant)
  if (inflight) return inflight

  setState({ status: state.tenant ? state.status : 'loading', error: null })
  const request = (isApiConfigured() ? getTenant() : Promise.resolve(LOCAL_DEMO_TENANT))
    .then((tenant) => {
      if (inflight !== request) return tenant
      const preferred = state.locationId ?? readStoredLocation(tenant.tenantId)
      const locationId = pickLocation(tenant, preferred)
      if (locationId) writeStoredLocation(tenant.tenantId, locationId)
      setState({ status: 'ready', tenant, error: null, locationId })
      return tenant
    })
    .catch((err: unknown) => {
      if (inflight !== request) return null
      // Ett tidigare lyckat svar ligger kvar vid en tillfällig störning —
      // men aldrig vid 401/403: då gäller inte den gamla datan längre.
      const code = errorCode(err)
      const keep = code === 'unavailable' && state.tenant
      setState({
        status: keep ? 'ready' : 'error',
        error: code,
        tenant: keep ? state.tenant : null,
        locationId: keep ? state.locationId : null,
      })
      return keep ? state.tenant : null
    })
    .finally(() => {
      if (inflight === request) inflight = null
    })
  inflight = request
  return request
}

/** Byter plats (sidebarens väljare). Bara platser restaurangen har godtas. */
export function selectLocation(locationId: string): void {
  const tenant = state.tenant
  if (!tenant || !tenant.locations.some((l) => l.locationId === locationId)) {
    return
  }
  writeStoredLocation(tenant.tenantId, locationId)
  setState({ locationId })
}

/**
 * Restaurangen för den inloggade. Laddas första gången den används och
 * delas sedan av hela appen.
 */
export function useTenant(): TenantState & {
  refresh: () => Promise<Tenant | null>
} {
  const { sub } = useAuth()
  const snapshot = useSyncExternalStore(subscribe, getTenantState, getTenantState)

  useEffect(() => {
    void loadTenant(sub)
  }, [sub])

  // Tills effekten hunnit köra för en ny användare: visa inget av den förra.
  const current: TenantState =
    snapshot.sub === sub ? snapshot : { ...INITIAL, sub, status: 'loading' }
  return { ...current, refresh: () => loadTenant(sub, { force: true }) }
}

/** Den valda platsens sammanfattning (namn/adress/tidszon), eller null. */
export function currentLocation(s: TenantState): TenantLocation | null {
  return s.tenant?.locations.find((l) => l.locationId === s.locationId) ?? null
}
