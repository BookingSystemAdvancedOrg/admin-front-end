import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

/** Skyddar admin-sidorna: skickar utloggade användare till /logga-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <div className="auth-splash">Laddar…</div>
  }
  if (status === 'signed-out') {
    return <Navigate to="/logga-in" replace state={{ from: location }} />
  }
  return <>{children}</>
}
