import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { roleAllows } from './nav'
import { useTenant } from './tenant'

/**
 * Personalen som skriver adressen till en ägarsida (t.ex. /personal) skickas
 * till Översikt med en kort förklaring, i stället för att se en halv sida.
 * Förklaringen står kvar på Översikt (även om guiden startar) och försvinner
 * vid nästa sidbyte.
 */
export function RoleGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { tenant } = useTenant()
  const blocked = !roleAllows(pathname, tenant)
  const [notice, setNotice] = useState(false)
  useEffect(() => {
    if (blocked) setNotice(true)
    else if (pathname !== '/') setNotice(false)
  }, [blocked, pathname])
  if (blocked) return <Navigate to="/" replace />
  return (
    <>
      {notice && pathname === '/' && (
        <div className="role-notice-wrap">
          <p className="role-notice" role="status">
            Den sidan är bara för restaurangens ägare. Du är tillbaka på Översikt.
          </p>
        </div>
      )}
      {children}
    </>
  )
}
