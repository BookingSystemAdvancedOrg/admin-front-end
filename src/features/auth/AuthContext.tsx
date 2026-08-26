import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './context'
import type { AuthStatus } from './context'
import type { PendingChallenge } from './cognito'
import {
  completeNewPassword,
  getCurrentSession,
  getIdToken,
  signIn,
  signOut,
} from './cognito'
import {
  clearMockSession,
  getMockSessionEmail,
  tryMockSignIn,
} from './mockAuth'

/**
 * Håller hela inloggningsläget för appen: vem som är inloggad, om ett
 * nytt lösenord krävs (Cognitos NEW_PASSWORD_REQUIRED-utmaning), och
 * funktionerna sidorna anropar för att logga in/ut. Wrappas runt hela
 * appen i main.tsx så att useAuth() fungerar överallt.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    getMockSessionEmail() ? 'signed-in' : 'loading',
  )
  const [email, setEmail] = useState<string | null>(() => getMockSessionEmail())
  const [hasPendingNewPassword, setHasPendingNewPassword] = useState(false)
  // Utmaningens session + username måste hållas i minnet mellan login-sidan
  // och nytt-lösenord-sidan tills /auth/challenge slutförs.
  const pendingChallenge = useRef<PendingChallenge | null>(null)

  useEffect(() => {
    if (getMockSessionEmail()) return
    let cancelled = false
    getCurrentSession().then((session) => {
      if (cancelled) return
      if (session) {
        setEmail(session.email)
        setStatus('signed-in')
      } else {
        setStatus('signed-out')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(
    async (loginEmail: string, password: string) => {
      if (tryMockSignIn(loginEmail, password)) {
        pendingChallenge.current = null
        setHasPendingNewPassword(false)
        setEmail(loginEmail.trim())
        setStatus('signed-in')
        return 'ok' as const
      }
      const result = await signIn(loginEmail, password)
      if (result.kind === 'new-password-required') {
        pendingChallenge.current = result.pending
        setEmail(loginEmail.trim())
        setHasPendingNewPassword(true)
        return 'new-password' as const
      }
      pendingChallenge.current = null
      setHasPendingNewPassword(false)
      setEmail(result.session.email ?? loginEmail.trim())
      setStatus('signed-in')
      return 'ok' as const
    },
    [],
  )

  const finishNewPassword = useCallback(async (newPassword: string) => {
    const pending = pendingChallenge.current
    if (!pending) {
      throw new Error('Ingen pågående inloggning. Logga in igen.')
    }
    const session = await completeNewPassword(pending, newPassword)
    pendingChallenge.current = null
    setHasPendingNewPassword(false)
    setEmail((prev) => session.email ?? prev)
    setStatus('signed-in')
  }, [])

  const logout = useCallback(() => {
    clearMockSession()
    signOut()
    pendingChallenge.current = null
    setHasPendingNewPassword(false)
    setEmail(null)
    setStatus('signed-out')
  }, [])

  const getToken = useCallback(async () => {
    if (getMockSessionEmail()) return 'mock-dev-token'
    return getIdToken()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        status,
        email,
        hasPendingNewPassword,
        login,
        finishNewPassword,
        logout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
