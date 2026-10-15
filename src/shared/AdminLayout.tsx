import { NavLink, Outlet } from 'react-router-dom'
import { BrandMark, BrandWordmark } from './BrandMark'
import { useAuth } from '../features/auth/useAuth'
import { primaryGroupLabel } from '../features/installningar/usersApi'
import { selectLocation, useTenant } from './tenant'
import { GuideProvider } from '../features/guide/Guide'
import type { TenantErrorCode } from './tenant'
import './admin.css'

// Sidebar-länkarna. `end: true` gör att '/' bara markeras aktiv på exakt
// träff, annars skulle den lysa upp på alla undersidor också.
const NAV: { to: string; label: string; tour: string; end?: boolean; feature?: string }[] = [
  { to: '/', label: 'Översikt', tour: 'nav-oversikt', end: true },
  { to: '/bokningar', label: 'Bokningar', tour: 'nav-bokningar' },
  // Bara för restauranger vars plan har matbeställning.
  { to: '/bestallningar', label: 'Beställningar', tour: 'nav-bestallningar', feature: 'ordering' },
  { to: '/meny', label: 'Meny', tour: 'nav-meny' },
  // Förfrågningar; inställningar och rabatter nås därifrån (/cateringkalkyl).
  { to: '/catering', label: 'Catering', tour: 'nav-catering', feature: 'catering' },
  { to: '/layout', label: 'Layout', tour: 'nav-layout' },
  { to: '/installningar', label: 'Inställningar', tour: 'nav-installningar' },
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
  const { email, sub, groups, logout } = useAuth()
  const { tenant, status, error, locationId, refresh } = useTenant()
  // Visningsnamn = det som står innan '@' i e-posten, t.ex. "anna@..." -> "anna".
  const displayName = email ? email.split('@')[0] : 'Personal'
  const initial = (displayName[0] ?? 'K').toUpperCase()
  const locations = tenant?.locations ?? []

  return (
    <GuideProvider
      user={sub ?? email ?? null}
      context={{
        isOwner: tenant?.role === 'owner_user',
        features: tenant?.entitlements.features ?? {},
        locations: locations.length,
      }}
      autoStart={status === 'ready' && import.meta.env.MODE !== 'test'}
    >
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <span className="admin-logo-badge" aria-hidden="true">
            <BrandMark />
          </span>
          <span className="admin-logo-text">
            <span className="admin-logo-brand">
              <BrandWordmark height={18} />
              <span className="admin-logo-tag">ADMIN</span>
            </span>
            <span className="admin-logo-name">{tenant?.name ?? ''}</span>
          </span>
        </div>

        {locations.length > 1 && (
          <div className="admin-location-picker" data-tour="location-picker">
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
              data-tour={item.tour}
              className={({ isActive }) =>
                isActive ? 'admin-nav-item active' : 'admin-nav-item'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-spacer" />

        <nav className="admin-nav admin-nav--bottom" aria-label="Hjälp">
          <NavLink
            to="/hjalp"
            data-tour="nav-hjalp"
            className={({ isActive }) => (isActive ? 'admin-nav-item active' : 'admin-nav-item')}
          >
            Hjälp
          </NavLink>
        </nav>

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
    </GuideProvider>
  )
}
