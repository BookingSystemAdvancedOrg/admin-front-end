import { useContext } from 'react'
import { AuthContext } from './context'
import type { AuthContextValue } from './context'

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth måste användas inuti <AuthProvider>.')
  return ctx
}
