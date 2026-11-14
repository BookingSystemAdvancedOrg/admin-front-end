import { API_BASE_URL } from '../../shared/api'
import { LEGACY_SESSION_KEY, LOGOUT_PENDING_KEY } from '../../shared/storageRegistry'

/**
 * Inloggningen går genom backendens /auth/*-endpoints (manage-auth-Lambdan),
 * som håller Cognito-app-klientens secret och anropar Cognito server-side.
 * Webbläsaren pratar aldrig direkt med Cognito - se docs/API-OCH-NYCKLAR.md
 * och backend-repots openapi.yaml för det fullständiga kontraktet.
 *
 * Sessionen (cookie-session, X-Booqy-Session: cookie):
 * - Refresh-tokenen ligger i en HttpOnly-cookie som servern sätter
 *   (__Secure-booqy_rt, bara för /api/auth på den här adressen). Inget
 *   skript på sidan kan läsa den, så en XSS kan inte stjäla sessionen.
 * - Access- och ID-tokenen (1 timme) finns bara i minnet i den här fliken.
 *   Vid omladdning eller i en ny flik hämtas nya via cookien.
 * - Ingenting om inloggningen sparas i localStorage/sessionStorage.
 */

type AuthenticationResult = {
  AccessToken: string
  IdToken?: string
  RefreshToken?: string
  ExpiresIn: number
  TokenType: string
}

type AuthResponse =
  | { status: 'authenticated'; authenticationResult: AuthenticationResult }
  | {
      status: 'challenge'
      challengeName: string
      challengeParameters: Record<string, string>
      session: string | null
      challengeUsername?: string
    }

export type PendingChallenge = {
  challengeName: string
  session: string
  username: string
}

export type StoredSession = {
  accessToken: string
  idToken: string
  /** Alltid null: refresh-tokenen ligger i en HttpOnly-cookie. */
  refreshToken: string | null
  sub: string
  email: string | null
  /** Cognito-grupperna (staff_user/owner_user/super_user) från cognito:groups-claimet. */
  groups: string[]
  expiresAt: number
}

export type SignInResult =
  | { kind: 'success'; session: StoredSession }
  | { kind: 'new-password-required'; pending: PendingChallenge }

const SESSION_HEADERS = { 'Content-Type': 'application/json', 'X-Booqy-Session': 'cookie' }

/** JWT-payloaden är bara base64url-kodad JSON - inget bibliotek behövs för att läsa ut claims. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? ''
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(json) as Record<string, unknown>
}

function groupsFromClaims(claims: Record<string, unknown>): string[] {
  const rawGroups = claims['cognito:groups']
  return Array.isArray(rawGroups)
    ? rawGroups.filter((g): g is string => typeof g === 'string')
    : []
}

function toStoredSession(result: AuthenticationResult): StoredSession {
  const idToken = result.IdToken ?? ''
  const claims = idToken ? decodeJwtPayload(idToken) : {}
  return {
    accessToken: result.AccessToken,
    idToken,
    refreshToken: null,
    sub: typeof claims.sub === 'string' ? claims.sub : '',
    email: typeof claims.email === 'string' ? claims.email : null,
    groups: groupsFromClaims(claims),
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  }
}

// Sessionen för den här fliken. Bara i minnet.
let current: StoredSession | null = null
// Pågående förnyelse, delad så att samtidiga anrop inte förnyar två gånger
// (med roterande refresh-tokens skulle det andra anropet använda en token
// som just ersatts).
let refreshing: Promise<StoredSession | null> | null = null
// Räknas upp vid varje utloggning: en förnyelse som startade före den
// kastas, så att den inte lägger tillbaka sessionen efteråt.
let signOutGeneration = 0

// Utloggning i en flik loggar ut alla flikar.
const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('booqy-admin-auth') : null
const signedOutListeners = new Set<() => void>()
channel?.addEventListener('message', (event: MessageEvent) => {
  if (event.data !== 'signed-out') return
  signOutGeneration += 1
  current = null
  clearTimeout(proactiveTimer)
  clearTimeout(retryTimer)
  setUnreachable(false)
  signedOutListeners.forEach((listener) => listener())
})

/**
 * Anropas när en annan flik loggar ut, eller när servern säger att sessionen
 * är slut (refresh-tokenen utgången eller återkallad). Returnerar en avregistrering.
 */
export function onSignedOutElsewhere(listener: () => void): () => void {
  signedOutListeners.add(listener)
  return () => {
    signedOutListeners.delete(listener)
  }
}

function logoutPending(): boolean {
  try {
    return localStorage.getItem(LOGOUT_PENDING_KEY) === '1'
  } catch {
    return false
  }
}

function setLogoutPending(pending: boolean): void {
  try {
    if (pending) localStorage.setItem(LOGOUT_PENDING_KEY, '1')
    else localStorage.removeItem(LOGOUT_PENDING_KEY)
  } catch {
    // Lagring avstängd: utloggningen försöks ändå direkt.
  }
}

/** Tar bort sessioner som äldre versioner sparade i localStorage. */
function dropLegacySession(): void {
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY)
  } catch {
    // Lagring avstängd i webbläsaren - inget att städa.
  }
}
dropLegacySession()

export function isApiAuthConfigured(): boolean {
  return Boolean(API_BASE_URL)
}

async function authRequest(path: string, body: unknown): Promise<AuthResponse> {
  if (!API_BASE_URL) {
    throw new Error(
      'VITE_API_BASE_URL är inte satt. Se docs/API-OCH-NYCKLAR.md.',
    )
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: SESSION_HEADERS,
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Auth] Nätverksfel mot', path, err)
    throw new Error('Kunde inte nå inloggningstjänsten. Kontrollera anslutningen och försök igen.')
  }
  if (!res.ok) {
    throw await toFriendlyError(res)
  }
  return (await res.json()) as AuthResponse
}

/** Mappar API:ts { error: string } + statuskod till svenska meddelanden. */
async function toFriendlyError(res: Response): Promise<Error> {
  let message = `HTTP ${res.status}`
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) message = body.error
  } catch {
    // Inget JSON-svar att läsa ut.
  }
  console.error(`[Auth] ${res.status}: ${message}`)

  switch (res.status) {
    case 401:
      return new Error('Fel e-post eller lösenord.')
    case 403:
      if (message.includes('not confirmed')) {
        return new Error(
          'Kontot är inte bekräftat ännu. Kontakta en administratör.',
        )
      }
      if (message.includes('reset')) {
        return new Error('Lösenordet måste återställas. Klicka på "Glömt lösenordet?".')
      }
      if (message === 'account_disabled') {
        return new Error('Kontot är avstängt. Kontakta restaurangens ägare.')
      }
      if (message === 'account_not_provisioned') {
        return new Error(
          'Kontot är inte kopplat till någon restaurang. Kontakta restaurangens ägare.',
        )
      }
      return new Error(message)
    case 429:
      return new Error('För många försök. Vänta en stund och försök igen.')
    case 502:
      return new Error(
        'Ingen kontakt med autentiseringstjänsten just nu. Försök igen om en stund.',
      )
    case 400:
      return new Error(
        message === 'invalid challenge response'
          ? 'Lösenordet uppfyller inte kraven, eller sessionen har gått ut. Logga in igen.'
          : message,
      )
    default:
      return new Error(message)
  }
}

function toSignInResult(response: AuthResponse, fallbackUsername: string): SignInResult {
  if (response.status === 'authenticated') {
    const session = toStoredSession(response.authenticationResult)
    current = session
    setUnreachable(false)
    scheduleProactiveRefresh()
    return { kind: 'success', session }
  }
  return {
    kind: 'new-password-required',
    pending: {
      challengeName: response.challengeName,
      session: response.session ?? '',
      // Kontraktet: använd challengeUsername när den finns, annars originalanvändaren.
      username: response.challengeUsername ?? fallbackUsername,
    },
  }
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const username = email.trim()
  const response = await authRequest('/auth/login', { username, password })
  return toSignInResult(response, username)
}

/** Slutför NEW_PASSWORD_REQUIRED (eller annan) utmaning från /auth/login. */
export async function completeNewPassword(
  pending: PendingChallenge,
  newPassword: string,
): Promise<StoredSession> {
  const response = await authRequest('/auth/challenge', {
    challengeName: pending.challengeName,
    session: pending.session,
    username: pending.username,
    responses: { NEW_PASSWORD: newPassword },
  })
  const result = toSignInResult(response, pending.username)
  if (result.kind === 'new-password-required') {
    throw new Error('Ytterligare en utmaning krävs, men stöds inte av gränssnittet ännu.')
  }
  return result.session
}

/**
 * "Glömt lösenordet?" (backend /auth/forgot-password och /auth/reset-password,
 * Cognito ForgotPassword/ConfirmForgotPassword). Felen har svenska texter;
 * `needsNewLink` betyder att länken/koden inte går att använda längre.
 */
export class PasswordResetError extends Error {
  readonly status: number
  readonly code: string
  readonly needsNewLink: boolean

  constructor(status: number, code: string) {
    super(resetErrorText(status, code))
    this.name = 'PasswordResetError'
    this.status = status
    this.code = code
    this.needsNewLink =
      status === 400 && ['invalid code', 'code expired', 'invalid reset request'].includes(code)
  }
}

function resetErrorText(status: number, code: string): string {
  if (status === 400) {
    switch (code) {
      case 'invalid code':
        return 'Länken eller koden fungerar inte längre - den kan redan ha använts eller ersatts av en nyare. Begär en ny länk.'
      case 'code expired':
        return 'Länken har gått ut (den gäller en timme). Begär en ny länk.'
      case 'invalid reset request':
        return 'Uppgifterna stämmer inte. Begär en ny länk.'
      case 'password does not meet requirements':
        return 'Lösenordet uppfyller inte kraven.'
      case 'username must be an email address':
        return 'Fyll i en giltig e-postadress.'
      case 'code must be the 6-digit code from the email':
        return 'Koden är de sex siffrorna i mejlet.'
      default:
        return 'Kontrollera uppgifterna och försök igen.'
    }
  }
  if (status === 403 && code === 'account_disabled') {
    return 'Kontot är avstängt. Kontakta restaurangens ägare.'
  }
  if (status === 429) return 'För många försök. Vänta en stund och försök igen.'
  return 'Ingen kontakt med inloggningstjänsten just nu. Försök igen om en stund.'
}

async function resetRequest(path: string, body: unknown): Promise<void> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL är inte satt. Se docs/API-OCH-NYCKLAR.md.')
  }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Auth] Nätverksfel mot', path, err)
    throw new Error('Kunde inte nå inloggningstjänsten. Kontrollera anslutningen och försök igen.')
  }
  if (res.ok) return
  let code = ''
  try {
    code = ((await res.json()) as { error?: string }).error ?? ''
  } catch {
    // Inget JSON-svar att läsa ut.
  }
  console.error(`[Auth] ${res.status}: ${code}`)
  throw new PasswordResetError(res.status, code)
}

/**
 * Ber om ett mejl med en länk för att välja nytt lösenord. Svaret är detsamma
 * oavsett om adressen har ett konto (servern avslöjar aldrig vilka som har det).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await resetRequest('/auth/forgot-password', { username: email.trim() })
}

/** Sätter det nya lösenordet med koden från länken (eller mejlet). */
export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await resetRequest('/auth/reset-password', {
    username: email.trim(),
    code: code.replace(/\s+/g, ''),
    newPassword,
  })
}

/**
 * Servern gick inte att nå (offline, nätverksfel, timeout, 5xx, 429). Det
 * betyder INTE utloggad: refresh-cookien gäller i 30 dagar och används igen
 * så fort kontakten är tillbaka.
 */
export class AuthUnavailableError extends Error {
  constructor() {
    super('Ingen kontakt med servern. Kontrollera internetanslutningen och försök igen.')
    this.name = 'AuthUnavailableError'
  }
}

/** Bara de här svaren från /auth/refresh betyder att sessionen är slut. */
const SIGNED_OUT_STATUSES = new Set([400, 401, 403])
/** Ett /auth/refresh som hänger (t.ex. Wi-Fi som inte är uppe) avbryts. */
const REFRESH_TIMEOUT_MS = 15_000
/**
 * Snabba omförsök inom samma förnyelse. Med roterande refresh-tokens gäller
 * den gamla tokenen bara en kort stund (retry_grace_period_seconds) om
 * svaret med den nya tappades, så första omförsöket måste komma snabbt.
 */
export const REFRESH_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000]
/** Därefter försöker appen i bakgrunden, allt glesare, tills kontakten är tillbaka. */
export const BACKGROUND_RETRY_DELAYS_MS: readonly number[] = [10_000, 20_000, 30_000, 60_000]
/** Access-tokenen förnyas så här långt innan den går ut. */
export const REFRESH_AHEAD_MS = 5 * 60_000
/** Marginal mot klockskillnad när en token används direkt. */
const MIN_VALIDITY_MS = 30_000

// Väntan mellan försöken; en utloggning väcker den direkt.
let wakeRetryWait: (() => void) | null = null
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      if (wakeRetryWait === done) wakeRetryWait = null
      resolve()
    }
    const timer = setTimeout(done, ms)
    wakeRetryWait = done
  })

/** Ett försök mot /auth/refresh. null = utloggad; kastar AuthUnavailableError annars. */
async function refreshOnce(): Promise<StoredSession | null> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS) : null
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: SESSION_HEADERS,
      credentials: 'same-origin',
      body: '{}',
      signal: controller?.signal,
    })
  } catch (err) {
    console.warn('[Auth] Ingen kontakt vid förnyelse', err)
    throw new AuthUnavailableError()
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (SIGNED_OUT_STATUSES.has(res.status)) return null
  if (!res.ok) {
    console.warn(`[Auth] Förnyelsen svarade ${res.status}; försöker igen.`)
    throw new AuthUnavailableError()
  }
  let response: AuthResponse
  try {
    response = (await res.json()) as AuthResponse
  } catch {
    throw new AuthUnavailableError()
  }
  if (response.status !== 'authenticated') return null
  return toStoredSession(response.authenticationResult)
}

/** Nya tokens via refresh-cookien. null = inte inloggad (eller utgången). */
async function refreshSession(): Promise<StoredSession | null> {
  if (!API_BASE_URL) return null
  // En utloggning som inte nådde servern förra gången: gör klart den först
  // i stället för att logga in igen med cookien som blev kvar.
  if (logoutPending()) {
    await revokeOnServer()
    return null
  }
  // Utloggad (här eller i en annan flik) under försöken: sluta direkt, så
  // att utloggningen inte väntar ut omförsöken.
  const generation = signOutGeneration
  const loggedOut = () => generation !== signOutGeneration || logoutPending()
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await refreshOnce()
    } catch (err) {
      if (loggedOut()) return null
      if (attempt >= REFRESH_RETRY_DELAYS_MS.length) throw err
      await wait(REFRESH_RETRY_DELAYS_MS[attempt])
      if (loggedOut()) return null
    }
  }
}

/**
 * Bara en flik åt gången förnyar (Web Locks): med roterande refresh-tokens
 * skulle två flikar annars skicka samma token samtidigt. Cookien som den
 * första fliken får tillbaka används automatiskt av nästa.
 */
function refreshAcrossTabs(): Promise<StoredSession | null> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return refreshSession()
  return locks.request('booqy-admin-refresh', () => refreshSession())
}

// Kontakten med inloggningstjänsten och sessionens livscykel, för AuthContext.
let unreachable = false
const connectionListeners = new Set<(unreachable: boolean) => void>()
const sessionListeners = new Set<(session: StoredSession) => void>()

/** true medan servern inte går att nå (sessionen finns kvar). Returnerar en avregistrering. */
export function onConnectionChange(listener: (unreachable: boolean) => void): () => void {
  connectionListeners.add(listener)
  return () => {
    connectionListeners.delete(listener)
  }
}

/** En förnyelse lyckades (t.ex. när kontakten kom tillbaka). Returnerar en avregistrering. */
export function onSessionRestored(listener: (session: StoredSession) => void): () => void {
  sessionListeners.add(listener)
  return () => {
    sessionListeners.delete(listener)
  }
}

export function isAuthUnreachable(): boolean {
  return unreachable
}

function setUnreachable(next: boolean): void {
  if (next === unreachable) return
  unreachable = next
  connectionListeners.forEach((listener) => listener(next))
}

/**
 * Den aktuella sessionen: från minnet om access-tokenen fortfarande gäller,
 * annars förnyad via cookien (efter omladdning, i en ny flik, efter en timme).
 * null = utloggad. Kastar AuthUnavailableError när servern inte går att nå:
 * då är man fortfarande inloggad och appen försöker igen i bakgrunden.
 */
export async function getCurrentSession(
  minValidityMs: number = MIN_VALIDITY_MS,
): Promise<StoredSession | null> {
  if (current && Date.now() < current.expiresAt - minValidityMs) return current
  return refreshNow()
}

async function refreshNow(): Promise<StoredSession | null> {
  const generation = signOutGeneration
  if (!refreshing) {
    refreshing = refreshAcrossTabs().finally(() => {
      refreshing = null
    })
  }
  let refreshed: StoredSession | null
  try {
    refreshed = await refreshing
  } catch (err) {
    if (generation !== signOutGeneration) return null
    if (!(err instanceof AuthUnavailableError)) throw err
    // Sessionen i minnet ligger kvar; nästa försök sker i bakgrunden.
    setUnreachable(true)
    scheduleBackgroundRetry()
    throw err
  }
  // Utloggad medan förnyelsen pågick: kasta resultatet.
  if (generation !== signOutGeneration) return null
  const hadSession = current !== null || unreachable
  current = refreshed
  retryIndex = 0
  clearTimeout(retryTimer)
  setUnreachable(false)
  if (refreshed) {
    scheduleProactiveRefresh()
    sessionListeners.forEach((listener) => listener(refreshed))
  } else {
    clearTimeout(proactiveTimer)
    if (hadSession) signedOutListeners.forEach((listener) => listener())
  }
  return refreshed
}

/**
 * Efter ett 401 från ett vanligt API-anrop: förnya en gång (om ingen annan
 * redan har gjort det sedan `usedToken` hämtades) och ge tillbaka den nya
 * access-tokenen. null = servern säger att man är utloggad på riktigt.
 */
export async function refreshAfterUnauthorized(usedToken: string | null): Promise<string | null> {
  if (current && current.accessToken !== usedToken && Date.now() < current.expiresAt - MIN_VALIDITY_MS) {
    return current.accessToken
  }
  const session = await refreshNow()
  return session?.accessToken || null
}

// Bakgrunden: förnyar i förväg och försöker igen när kontakten kommer tillbaka.
let keeperRunning = false
let proactiveTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryIndex = 0

function kick(): void {
  if (!keeperRunning) return
  if (!current && !unreachable) return
  void getCurrentSession(REFRESH_AHEAD_MS).catch(() => undefined)
}

function scheduleProactiveRefresh(): void {
  clearTimeout(proactiveTimer)
  if (!keeperRunning || !current) return
  const delay = Math.max(0, current.expiresAt - REFRESH_AHEAD_MS - Date.now())
  proactiveTimer = setTimeout(kick, delay)
}

function scheduleBackgroundRetry(): void {
  clearTimeout(retryTimer)
  if (!keeperRunning) return
  const delay = BACKGROUND_RETRY_DELAYS_MS[Math.min(retryIndex, BACKGROUND_RETRY_DELAYS_MS.length - 1)]
  retryIndex += 1
  retryTimer = setTimeout(kick, delay)
}

/**
 * Startar bakgrunden (anropas en gång av AuthProvider): access-tokenen
 * förnyas några minuter innan den går ut, direkt när datorn vaknar, när
 * fönstret får fokus igen och när nätet kommer tillbaka. Returnerar stopp.
 */
export function startSessionKeeper(): () => void {
  if (typeof window === 'undefined') return () => undefined
  keeperRunning = true
  const onVisible = () => {
    if (document.visibilityState === 'visible') kick()
  }
  // Datorn har sovit: timers står still under sömnen, så ett glapp i
  // klockan betyder att den just vaknade.
  let last = Date.now()
  const wakeCheck = setInterval(() => {
    const now = Date.now()
    if (now - last > 60_000) kick()
    last = now
  }, 20_000)
  window.addEventListener('online', kick)
  window.addEventListener('focus', kick)
  document.addEventListener('visibilitychange', onVisible)
  scheduleProactiveRefresh()
  if (unreachable) scheduleBackgroundRetry()
  return () => {
    keeperRunning = false
    clearInterval(wakeCheck)
    clearTimeout(proactiveTimer)
    clearTimeout(retryTimer)
    window.removeEventListener('online', kick)
    window.removeEventListener('focus', kick)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession()
  return session?.idToken ?? null
}

/**
 * Access-tokenen är den som API:ts JWT-authorizer förväntar sig (se
 * openapi-spec:en: "invalid Cognito access token") - ID-tokenen är till för
 * klienten själv (e-post m.m.), inte för Authorization-headern.
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession()
  return session?.accessToken || null
}

export function clearSession(): void {
  current = null
  clearTimeout(proactiveTimer)
}

/** Ber servern återkalla refresh-tokenen och radera cookien. true = klart. */
async function revokeOnServer(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: SESSION_HEADERS,
        credentials: 'same-origin',
        body: '{}',
      })
      if (res.ok) {
        setLogoutPending(false)
        return true
      }
    } catch {
      // Nätverksfel: försök en gång till.
    }
  }
  // Kvar till nästa start: då görs utloggningen klart innan någon förnyelse.
  setLogoutPending(true)
  console.error('[Auth] Utloggningen nådde inte servern; försöker igen vid nästa start.')
  return false
}

/**
 * Loggar ut: glömmer tokens i minnet, väntar ut en pågående förnyelse (så
 * att dess nya cookie inte landar efter raderingen), ber servern återkalla
 * refresh-tokenen och radera cookien, och säger sedan till andra flikar.
 * En markering sparas direkt och tas bort först när servern svarat, så att
 * nästa start loggar ut i stället för att logga in igen med cookien som
 * blev kvar (även om appen stängs mitt i). false =
 * servern nåddes inte.
 */
export async function signOut(): Promise<boolean> {
  signOutGeneration += 1
  current = null
  clearTimeout(proactiveTimer)
  clearTimeout(retryTimer)
  setUnreachable(false)
  if (!API_BASE_URL) return true
  // Markeringen först: stängs appen innan servern nåtts loggar nästa start
  // ut i stället för att förnya med cookien. revokeOnServer tar bort den.
  setLogoutPending(true)
  wakeRetryWait?.()
  if (refreshing) {
    await refreshing.catch(() => null)
  }
  const ok = await revokeOnServer()
  current = null
  channel?.postMessage('signed-out')
  return ok
}
