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
 */
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as
  | string
  | undefined
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined

export function isCognitoConfigured(): boolean {
  return Boolean(USER_POOL_ID && CLIENT_ID)
}

let pool: CognitoUserPool | null = null

function getPool(): CognitoUserPool {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error(
      'Cognito är inte konfigurerat. Skapa en .env-fil med VITE_COGNITO_USER_POOL_ID och VITE_COGNITO_CLIENT_ID — se docs/API-OCH-NYCKLAR.md.',
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
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code)
      : ''
  const message =
    err instanceof Error ? err.message : 'Ett okänt fel inträffade.'

  switch (code) {
    case 'NotAuthorizedException':
      return new Error(
        message.includes('expired')
          ? 'Ditt tillfälliga lösenord har gått ut. Be en administratör skicka en ny inbjudan.'
          : 'Fel e-post eller lösenord.',
      )
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
      return err instanceof Error ? err : new Error(message)
  }
}
