import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CognitoUser } from 'amazon-cognito-identity-js'
import { AuthContext } from './context'
import type { AuthStatus } from './context'
import {
  completeNewPassword,
  getCurrentSession,
  getIdToken,
  signIn,
  signOut,
} from './cognito'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [email, setEmail] = useState<string | null>(null)
  const [hasPendingNewPassword, setHasPendingNewPassword] = useState(false)
  // The CognitoUser holding the NEW_PASSWORD_REQUIRED challenge state must be
  // kept in memory between the login page and the new-password page.
  const pendingUser = useRef<CognitoUser | null>(null)

  useEffect(() => {
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
    signOut()
    pendingUser.current = null
    setHasPendingNewPassword(false)
    setEmail(null)
    setStatus('signed-out')
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
        getToken: getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
