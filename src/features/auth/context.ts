import { createContext } from 'react'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface AuthContextValue {
  status: AuthStatus
  /** E-postadressen för den inloggade (eller pågående) användaren. */
  email: string | null
  /** Cognito-subet (unikt användar-ID) för den inloggade användaren. */
  sub: string | null
  /** Cognito-grupperna (staff_user/owner_user/super_user) för behörighetskoll i UI:t. */
  groups: string[]
  /** True när inloggningen väntar på att ett nytt lösenord ska väljas. */
  hasPendingNewPassword: boolean
  /** Returnerar 'ok' vid inloggning, 'new-password' när nytt lösenord krävs. */
  login: (email: string, password: string) => Promise<'ok' | 'new-password'>
  /** Slutför "nytt lösenord"-steget för konton med tillfälligt lösenord. */
  finishNewPassword: (newPassword: string) => Promise<void>
  logout: () => void
  /** Färsk access-token (JWT) för Authorization-headern — den API:ts authorizer validerar. */
  getToken: () => Promise<string | null>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
