import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js'
import type { CognitoUserSession } from 'amazon-cognito-identity-js'

/**
 * All configuration comes from environment variables (see .env.example and
 * docs/API-OCH-NYCKLAR.md). Vite inlines these at build time, so the dev server
 * must be restarted after editing .env.
 *
 * The dev and prod pools live side by side in the same file with _DEV/_PROD
 * suffixes. VITE_COGNITO_ENV picks which pair is used (dev when unset), and
 * the unsuffixed names override both so a build can be pointed at a single
 * pool without changing the .env format.
 */

/** Reads an env var, treating blanks and unfilled placeholders as missing. */
function envValue(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value || value.startsWith('...') || value.includes('REPLACE_ME')) {
    return undefined
  }
  return value
}

const TARGET_ENV =
  envValue(import.meta.env.VITE_COGNITO_ENV)?.toLowerCase() === 'prod'
    ? 'prod'
    : 'dev'
const SUFFIX = TARGET_ENV === 'prod' ? '_PROD' : '_DEV'

const USER_POOL_ID =
  envValue(import.meta.env.VITE_COGNITO_USER_POOL_ID) ??
  (TARGET_ENV === 'prod'
    ? envValue(import.meta.env.VITE_COGNITO_USER_POOL_ID_PROD)
    : envValue(import.meta.env.VITE_COGNITO_USER_POOL_ID_DEV))

const CLIENT_ID =
  envValue(import.meta.env.VITE_COGNITO_CLIENT_ID) ??
  (TARGET_ENV === 'prod'
    ? envValue(import.meta.env.VITE_COGNITO_CLIENT_ID_PROD)
    : envValue(import.meta.env.VITE_COGNITO_CLIENT_ID_DEV))

export function isCognitoConfigured(): boolean {
  return Boolean(USER_POOL_ID && CLIENT_ID)
}

let pool: CognitoUserPool | null = null

function getPool(): CognitoUserPool {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error(
      `Cognito är inte konfigurerat. Fyll i VITE_COGNITO_USER_POOL_ID${SUFFIX} och VITE_COGNITO_CLIENT_ID${SUFFIX} i .env — se docs/API-OCH-NYCKLAR.md.`,
    )
  }
  if (!pool) {
    pool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
  }
  return pool
}

export type SignInResult =
  | { kind: 'success'; session: CognitoUserSession }
  | { kind: 'new-password-required'; user: CognitoUser }

/**
 * Signs in with email + password using SRP (the password never leaves the
 * browser in clear text). If the account still has its temporary password
 * from the Cognito invitation email, Cognito answers with the
 * NEW_PASSWORD_REQUIRED challenge and we return the pending user so the
 * "nytt lösenord" page can finish the flow.
 */
export function signIn(email: string, password: string): Promise<SignInResult> {
  const user = new CognitoUser({ Username: email.trim(), Pool: getPool() })
  const details = new AuthenticationDetails({
    Username: email.trim(),
    Password: password,
  })
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve({ kind: 'success', session }),
      onFailure: (err) => reject(toFriendlyError(err)),
      newPasswordRequired: () =>
        resolve({ kind: 'new-password-required', user }),
    })
  })
}

/**
 * Completes the NEW_PASSWORD_REQUIRED challenge for a user that just signed
 * in with a temporary password. On success the account is activated and a
 * full session is returned.
 */
export function completeNewPassword(
  user: CognitoUser,
  newPassword: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(toFriendlyError(err)),
    })
  })
}

/** Restores the session from local storage (valid tokens are auto-refreshed). */
export function getCurrentSession(): Promise<CognitoUserSession | null> {
  if (!isCognitoConfigured()) return Promise.resolve(null)
  const user = getPool().getCurrentUser()
  if (!user) return Promise.resolve(null)
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) resolve(null)
      else resolve(session)
    })
  })
}

/**
 * Returns a fresh ID token (JWT) to send to the backend as
 * `Authorization: Bearer <token>`, or null when signed out.
 */
export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession()
  return session ? session.getIdToken().getJwtToken() : null
}

export function signOut(): void {
  if (!isCognitoConfigured()) return
  getPool().getCurrentUser()?.signOut()
}

/** Maps Cognito error codes to Swedish messages users can act on. */
function toFriendlyError(err: unknown): Error {
  const raw = err as { code?: unknown; name?: unknown; message?: unknown }
  const code = String(raw?.code ?? raw?.name ?? '')
  const message =
    err instanceof Error ? err.message : 'Ett okänt fel inträffade.'

  // Cognito svarar alltid HTTP 400 på inloggningsfel, så webbläsarkonsolen
  // visar bara "400 (Bad Request)". Logga koden och AWS egna text så att
  // orsaken går att se direkt vid felsökning.
  console.error(`[Cognito] ${code || 'okänt fel'}: ${message}`)

  switch (code) {
    case 'InvalidParameterException':
      if (message.includes('USER_SRP_AUTH')) {
        return new Error(
          'App-klienten tillåter inte SRP-inloggning. Aktivera ALLOW_USER_SRP_AUTH på app-klienten i Cognito.',
        )
      }
      return new Error(`Cognito nekade anropet: ${message}`)
    case 'ResourceNotFoundException':
      return new Error(
        'Cognito hittar inte poolen eller app-klienten. Kontrollera VITE_COGNITO_*-värdena i .env.',
      )
    case 'NotAuthorizedException':
      if (message.includes('secret hash')) {
        return new Error(
          'App-klienten har en client secret. Frontend måste använda en publik klient utan secret — skapa en ny app-klient i Cognito.',
        )
      }
      if (message.includes('expired')) {
        return new Error(
          'Ditt tillfälliga lösenord har gått ut. Be en administratör skicka en ny inbjudan.',
        )
      }
      return new Error('Fel e-post eller lösenord.')
    case 'UserNotFoundException':
      return new Error('Fel e-post eller lösenord.')
    case 'UserNotConfirmedException':
      return new Error('Kontot är inte bekräftat ännu. Kontakta en administratör.')
    case 'PasswordResetRequiredException':
      return new Error(
        'Lösenordet måste återställas. Kontakta en administratör.',
      )
    case 'InvalidPasswordException':
      return new Error(
        'Lösenordet uppfyller inte kraven. Kontrollera listan nedan.',
      )
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return new Error('För många försök. Vänta en stund och försök igen.')
    case 'NetworkError':
      return new Error('Ingen kontakt med servern. Kontrollera din uppkoppling.')
    default:
      return new Error(code ? `${code}: ${message}` : message)
  }
}
