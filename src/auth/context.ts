import { createContext } from 'react'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export interface AuthContextValue {
  status: AuthStatus
  /** E-postadressen för den inloggade (eller pågående) användaren. */
  email: string | null
  /** True när inloggningen väntar på att ett nytt lösenord ska väljas. */
  hasPendingNewPassword: boolean
  /** Returnerar 'ok' vid inloggning, 'new-password' när nytt lösenord krävs. */
  login: (email: string, password: string) => Promise<'ok' | 'new-password'>
  /** Slutför "nytt lösenord"-steget för konton med tillfälligt lösenord. */
  finishNewPassword: (newPassword: string) => Promise<void>
  logout: () => void
  /** Färskt ID-token (JWT) för Authorization-headern mot API:t. */
  getToken: () => Promise<string | null>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
