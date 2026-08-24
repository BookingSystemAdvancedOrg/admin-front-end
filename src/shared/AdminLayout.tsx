import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth'
import './admin.css'

// Sidebar-länkarna. `end: true` gör att '/' bara markeras aktiv på exakt
// träff, annars skulle den lysa upp på alla undersidor också.
const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Översikt', end: true },
  { to: '/bokningar', label: 'Bokningar' },
  { to: '/meny', label: 'Meny' },
  { to: '/layout', label: 'Layout' },
  { to: '/installningar', label: 'Inställningar' },
]

/**
 * Admin-skalet med mörkgrön sidebar (Figma: admin-sidebar, 36:166).
 * Ritas runt varje sida via <Outlet /> (se App.tsx) så att sidebaren och
 * inloggad-användare-panelen bara behöver skrivas en gång.
 */
export function AdminLayout() {
  const { email, logout } = useAuth()
  // Visningsnamn = det som står innan '@' i e-posten, t.ex. "anna@..." -> "anna".
  const displayName = email ? email.split('@')[0] : 'Personal'
  const initial = (displayName[0] ?? 'K').toUpperCase()

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <span className="admin-logo-badge" aria-hidden="true">
            K
          </span>
          <span className="admin-logo-name">KÄLLA</span>
          <span className="admin-logo-tag">ADMIN</span>
        </div>

        <nav className="admin-nav" aria-label="Huvudmeny">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? 'admin-nav-item active' : 'admin-nav-item'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-spacer" />

        <div className="admin-user">
          <div className="admin-user-row" title={email ?? undefined}>
            <span className="admin-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="admin-user-name">{displayName} · Personal</span>
          </div>
          <button type="button" className="admin-logout" onClick={logout}>
            Logga ut
          </button>
        </div>
      </aside>

      <div className="admin-right">
        <Outlet />
      </div>
    </div>
  )
}
