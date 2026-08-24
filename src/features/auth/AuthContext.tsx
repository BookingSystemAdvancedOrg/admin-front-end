import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CognitoUser } from 'amazon-cognito-identity-js'
import { AuthContext } from './context'
import type { AuthStatus } from './context'
import {
  completeNewPassword,
  getCurrentSession,
  getIdToken,
  isCognitoConfigured,
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
  // The CognitoUser holding the NEW_PASSWORD_REQUIRED challenge state must be
  // kept in memory between the login page and the new-password page.
  const pendingUser = useRef<CognitoUser | null>(null)

  useEffect(() => {
    if (getMockSessionEmail()) return
    let cancelled = false
    getCurrentSession().then((session) => {
      if (cancelled) return
      if (session) {
        const payload = session.getIdToken().payload as { email?: string }
        setEmail(payload.email ?? null)
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
        pendingUser.current = null
        setHasPendingNewPassword(false)
        setEmail(loginEmail.trim())
        setStatus('signed-in')
        return 'ok' as const
      }
      if (!isCognitoConfigured()) {
        throw new Error('Fel e-post eller lösenord.')
      }
      const result = await signIn(loginEmail, password)
      if (result.kind === 'new-password-required') {
        pendingUser.current = result.user
        setEmail(loginEmail.trim())
        setHasPendingNewPassword(true)
        return 'new-password' as const
      }
      pendingUser.current = null
      setHasPendingNewPassword(false)
      const payload = result.session.getIdToken().payload as { email?: string }
      setEmail(payload.email ?? loginEmail.trim())
      setStatus('signed-in')
      return 'ok' as const
    },
    [],
  )

  const finishNewPassword = useCallback(async (newPassword: string) => {
    const user = pendingUser.current
    if (!user) {
      throw new Error('Ingen pågående inloggning. Logga in igen.')
    }
    const session = await completeNewPassword(user, newPassword)
    pendingUser.current = null
    setHasPendingNewPassword(false)
    const payload = session.getIdToken().payload as { email?: string }
    setEmail((prev) => payload.email ?? prev)
    setStatus('signed-in')
  }, [])

  const logout = useCallback(() => {
    clearMockSession()
    signOut()
    pendingUser.current = null
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
