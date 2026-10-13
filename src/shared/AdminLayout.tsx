import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth'
import { primaryGroupLabel } from '../features/installningar/usersApi'
import { selectLocation, useTenant } from './tenant'
import type { TenantErrorCode } from './tenant'
import './admin.css'

// Sidebar-länkarna. `end: true` gör att '/' bara markeras aktiv på exakt
// träff, annars skulle den lysa upp på alla undersidor också.
const NAV: { to: string; label: string; end?: boolean; feature?: string }[] = [
  { to: '/', label: 'Översikt', end: true },
  { to: '/bokningar', label: 'Bokningar' },
  // Bara för restauranger vars plan har matbeställning.
  { to: '/bestallningar', label: 'Beställningar', feature: 'ordering' },
  { to: '/meny', label: 'Meny' },
  // Förfrågningar; inställningar och rabatter nås därifrån (/cateringkalkyl).
  { to: '/catering', label: 'Catering', feature: 'catering' },
  { to: '/layout', label: 'Layout' },
  { to: '/installningar', label: 'Inställningar' },
]

const TENANT_ERROR: Record<TenantErrorCode, { title: string; text: string }> = {
  tenant_inactive: {
    title: 'Kontot är inte aktivt',
    text: 'Restaurangens konto är pausat eller avslutat. Kontakta support om det inte stämmer.',
  },
  no_tenant: {
    title: 'Inloggningen är inte kopplad till någon restaurang',
    text: 'Be restaurangens ägare eller support att bjuda in dig på nytt, och logga sedan in igen.',
  },
  unauthorized: {
    title: 'Du är utloggad',
    text: 'Logga in igen för att fortsätta.',
  },
  unavailable: {
    title: 'Kunde inte hämta restaurangen',
    text: 'Tjänsten svarar inte just nu. Försök igen om en stund.',
  },
}

/**
 * Admin-skalet med mörkgrön sidebar (Figma: admin-sidebar, 36:166).
 * Ritas runt varje sida via <Outlet /> (se App.tsx).
 *
 * Sidebaren visar RESTAURANGEN (tenant) från GET /tenant, och — när den har
 * flera — en väljare för platsen. Sidan monteras om vid platsbyte
 * (`key`), så ingen sida kan bära med sig osparat eller inläst innehåll från
 * en plats till en annan.
 */
export function AdminLayout() {
  const { email, groups, logout } = useAuth()
  const { tenant, status, error, locationId, refresh } = useTenant()
  // Visningsnamn = det som står innan '@' i e-posten, t.ex. "anna@..." -> "anna".
  const displayName = email ? email.split('@')[0] : 'Personal'
  const initial = (displayName[0] ?? 'K').toUpperCase()
  const locations = tenant?.locations ?? []

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <span className="admin-logo-badge" aria-hidden="true">
            {(tenant?.name?.[0] ?? 'R').toUpperCase()}
          </span>
          <span className="admin-logo-name">{tenant?.name ?? ''}</span>
          <span className="admin-logo-tag">ADMIN</span>
        </div>

        {locations.length > 1 && (
          <div className="admin-location-picker">
            <label htmlFor="admin-location">Plats</label>
            <select
              id="admin-location"
              value={locationId ?? ''}
              onChange={(e) => selectLocation(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.locationId} value={l.locationId}>
                  {l.name || 'Namnlös plats'}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="admin-nav" aria-label="Huvudmeny">
          {NAV.filter(
            (item) => !item.feature || Boolean(tenant?.entitlements.features[item.feature]),
          ).map((item) => (
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
            <span className="admin-user-name">
              {/* Rollen enligt servern när restaurangen är laddad. */}
              {displayName} · {primaryGroupLabel(tenant ? [tenant.role] : groups)}
            </span>
          </div>
          <button type="button" className="admin-logout" onClick={logout}>
            Logga ut
          </button>
        </div>
      </aside>

      <div className="admin-right">
        {status === 'error' && error ? (
          <div className="admin-main">
            <section className="admin-card table-card tenant-notice" role="alert">
              <h2 className="card-title">{TENANT_ERROR[error].title}</h2>
              <p className="cell-muted">{TENANT_ERROR[error].text}</p>
              <div className="row-actions">
                {error === 'unavailable' && (
                  <button
                    type="button"
                    className="btn primary square"
                    onClick={() => void refresh()}
                  >
                    Försök igen
                  </button>
                )}
                {error !== 'unavailable' && (
                  <button type="button" className="btn outline square" onClick={logout}>
                    Logga ut
                  </button>
                )}
              </div>
            </section>
          </div>
        ) : status === 'ready' ? (
          <Outlet key={locationId ?? 'no-location'} />
        ) : (
          <div className="admin-main">
            <p className="cell-muted" aria-live="polite">
              Hämtar restaurangen…
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
