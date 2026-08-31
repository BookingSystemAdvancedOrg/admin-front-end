import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './context'
import type { AuthStatus } from './context'
import type { PendingChallenge } from './cognito'
import {
  completeNewPassword,
  getAccessToken,
  getCurrentSession,
  signIn,
  signOut,
} from './cognito'
import {
  clearMockSession,
  getMockSessionEmail,
  tryMockSignIn,
} from './mockAuth'

// Mock-inloggningen (bara i npm run dev) har ingen riktig Cognito-session, så
// den ges den mest tillåtande gruppen för att kunna testa hela gränssnittet
// lokalt, inklusive personal-CRUD:et som kräver owner_user/super_user.
const MOCK_SUB = 'mock-dev-sub'
const MOCK_GROUPS = ['super_user']

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
  const [sub, setSub] = useState<string | null>(() =>
    getMockSessionEmail() ? MOCK_SUB : null,
  )
  const [groups, setGroups] = useState<string[]>(() =>
    getMockSessionEmail() ? MOCK_GROUPS : [],
  )
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
        setSub(session.sub || null)
        setGroups(session.groups)
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
        setSub(MOCK_SUB)
        setGroups(MOCK_GROUPS)
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
      setSub(result.session.sub || null)
      setGroups(result.session.groups)
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
    setSub(session.sub || null)
    setGroups(session.groups)
    setStatus('signed-in')
  }, [])

  const logout = useCallback(() => {
    clearMockSession()
    signOut()
    pendingChallenge.current = null
    setHasPendingNewPassword(false)
    setEmail(null)
    setSub(null)
    setGroups([])
    setStatus('signed-out')
  }, [])

  // Access-tokenen, inte ID-tokenen — det är den API:ts authorizer godtar.
  const getToken = useCallback(async () => {
    if (getMockSessionEmail()) return 'mock-dev-token'
    return getAccessToken()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        status,
        email,
        sub,
        groups,
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
