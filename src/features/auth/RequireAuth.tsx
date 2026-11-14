import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { SkelShell } from '../../shared/Skeleton'
import { Loading } from '../../shared/Loading'

/** Skyddar admin-sidorna: skickar utloggade användare till /logga-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, connectionLost } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    // Ingen kontakt vid start (t.ex. före Wi-Fi efter sömn): kvittot skrivs
    // tills servern svarar, aldrig inloggningen.
    if (connectionLost) return <Loading variant="screen" label="Ansluter" />
    return <SkelShell label="Laddar" />
  }
  if (status === 'signed-out') {
    return <Navigate to="/logga-in" replace state={{ from: location }} />
  }
  return <>{children}</>
}
