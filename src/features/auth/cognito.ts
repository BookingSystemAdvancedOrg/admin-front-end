import { API_BASE_URL } from '../../shared/api'

/**
 * Inloggningen går genom backendens /auth/*-endpoints (manage-auth-Lambdan),
 * som håller Cognito-app-klientens secret och anropar InitiateAuth /
 * RespondToAuthChallenge server-side. Webbläsaren pratar aldrig direkt med
 * Cognito — se docs/API-OCH-NYCKLAR.md och backend-repots openapi.yaml för
 * det fullständiga kontraktet.
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
  refreshToken: string | null
  sub: string
  email: string | null
  expiresAt: number
}

export type SignInResult =
  | { kind: 'success'; session: StoredSession }
  | { kind: 'new-password-required'; pending: PendingChallenge }

const STORAGE_KEY = 'admin-auth-session'

/** JWT-payloaden är bara base64url-kodad JSON — inget bibliotek behövs för att läsa ut claims. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? ''
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(json) as Record<string, unknown>
}

function toStoredSession(result: AuthenticationResult): StoredSession {
  const idToken = result.IdToken ?? ''
  const claims = idToken ? decodeJwtPayload(idToken) : {}
  return {
    accessToken: result.AccessToken,
    idToken,
    refreshToken: result.RefreshToken ?? null,
    sub: typeof claims.sub === 'string' ? claims.sub : '',
    email: typeof claims.email === 'string' ? claims.email : null,
    expiresAt: Date.now() + result.ExpiresIn * 1000,
  }
}

function saveSession(session: StoredSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error('[Auth] Nätverksfel mot', path, err)
    throw new Error(
      'Kunde inte nå inloggningstjänsten. Kontrollera anslutningen, eller att din dev-origin är tillåten i API:ts CORS-inställningar.',
    )
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
        return new Error('Lösenordet måste återställas. Kontakta en administratör.')
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
    saveSession(session)
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

async function refreshSession(session: StoredSession): Promise<StoredSession | null> {
  if (!session.refreshToken || !session.sub) return null
  try {
    const response = await authRequest('/auth/refresh', {
      refreshToken: session.refreshToken,
      sub: session.sub,
    })
    if (response.status !== 'authenticated') return null
    // Cognito returnerar normalt ingen ny RefreshToken vid refresh - behåll den gamla.
    const refreshed = toStoredSession({
      ...response.authenticationResult,
      RefreshToken: response.authenticationResult.RefreshToken ?? session.refreshToken,
    })
    saveSession(refreshed)
    return refreshed
  } catch {
    return null
  }
}

/** Återställer sessionen från localStorage och förnyar den om den gått ut. */
export async function getCurrentSession(): Promise<StoredSession | null> {
  const session = loadSession()
  if (!session) return null
  if (Date.now() < session.expiresAt - 30_000) return session
  const refreshed = await refreshSession(session)
  if (!refreshed) clearSession()
  return refreshed
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession()
  return session?.idToken ?? null
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function signOut(): void {
  clearSession()
}
