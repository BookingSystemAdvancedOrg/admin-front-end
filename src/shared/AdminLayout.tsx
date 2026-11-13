import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BrandMark, BrandWordmark } from './BrandMark'
import { useAuth } from '../features/auth/useAuth'
import { primaryGroupLabel } from '../features/installningar/usersApi'
import { selectLocation, useTenant } from './tenant'
import { GuideProvider, useGuide } from '../features/guide/Guide'
import { LogoutConfirm } from './LogoutConfirm'
import type { TenantErrorCode } from './tenant'
import './admin.css'
import './brand.css'
import './select.css'
import { useLiquidFill } from './motion/useLiquidFill'
import { MotionScope, sidebarPourDone, sidebarShouldPour } from './motion/MotionScope'
import { BusyBar } from './motion/BusyBar'
import { DpaBanner } from '../features/dpa/DpaBanner'
import { SkelCard, SkelPage, SkelTiles } from './Skeleton'
import { NAV_CLOSED_KEY } from './storageRegistry'
import { preloadPages } from '../pages'
import { NAV_FOOTER, NAV_GROUPS, navVisible, onItem, recentPages, rememberPage, requestPageAction, visibleNav } from './nav'
import type { NavItem } from './nav'
import { Icon } from './Icon'
import { CommandPalette } from './CommandPalette'
import type { PaletteItem } from './CommandPalette'
import './ds.css'

/** Grupperna i sidomenyn som användaren har fällt ihop (sparas i webbläsaren). */
function storedClosedGroups(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_CLOSED_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

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
 * Sidebaren visar RESTAURANGEN (tenant) från GET /tenant, och - när den har
 * flera - en väljare för platsen. Sidan monteras om vid platsbyte
 * (`key`), så ingen sida kan bära med sig osparat eller inläst innehåll från
 * en plats till en annan.
 */
export function AdminLayout() {
  const { email, sub, groups, logout } = useAuth()
  const { tenant, status, error, locationId, refresh } = useTenant()
  const { pathname } = useLocation()
  // Sidomenyns grupper är öppna från början; en grupp man fäller ihop förblir
  // hopfälld i den här webbläsaren.
  const [closedGroups, setClosedGroups] = useState<string[]>(storedClosedGroups)
  // Telefon och surfplatta: menyn är en glaslåda från vänster som öppnas med
  // menyknappen och stängs vid sidbyte, Esc eller klick utanför.
  const [drawer, setDrawer] = useState(false)
  useEffect(() => {
    setDrawer(false)
    rememberPage(pathname)
  }, [pathname])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])
  // Skalet och första sidan är uppe: resten av sidorna hämtas i bakgrunden.
  useEffect(() => {
    if (status === 'ready') preloadPages()
  }, [status])

  // Går man till en sida i en hopfälld grupp (en länk, eller guiden) öppnas
  // gruppen igen, så att sidan man står på alltid syns i menyn.
  useEffect(() => {
    const group = NAV_GROUPS.find((g) => g.label && g.items.some((item) => onItem(pathname, item)))
    if (group && closedGroups.includes(group.id)) toggleGroup(group.id, false)
    // bara när sidan byts, inte när användaren fäller ihop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
  function toggleGroup(id: string, open: boolean) {
    setClosedGroups((prev) => {
      const next = open ? [...prev.filter((x) => x !== id), id] : prev.filter((x) => x !== id)
      try {
        localStorage.setItem(NAV_CLOSED_KEY, JSON.stringify(next))
      } catch {
        /* privat läge utan lagring: valet gäller tills sidan laddas om */
      }
      return next
    })
  }
  // Visningsnamn = det som står innan '@' i e-posten, t.ex. "anna@..." -> "anna".
  const displayName = email ? email.split('@')[0] : 'Personal'
  const initial = (displayName[0] ?? 'K').toUpperCase()
  const locations = tenant?.locations ?? []
  // Sidomenyns "Logga ut" frågar först (felrutorna nedan loggar ut direkt -
  // där går appen ändå inte att använda).
  const [confirmLogout, setConfirmLogout] = useState(false)
  const cancelLogout = useCallback(() => setConfirmLogout(false), [])

  // En gång per inloggning: väggen fylls med vinrött (samma vatten som
  // nyckeltalsrutorna). Sidbyten, flikbyten och omladdningar rör den inte.
  const [pour] = useState(sidebarShouldPour)
  const sidebarRef = useRef<HTMLElement>(null)
  const sidebarCanvas = useRef<HTMLCanvasElement>(null)
  const [poured, setPoured] = useState(!pour)
  const wall = useLiquidFill(sidebarRef, sidebarCanvas, {
    active: pour && status === 'ready',
    fillMs: 1900,
    pourAt: 0.5,
    onProgress: (_, done) => {
      if (done) {
        sidebarPourDone()
        setPoured(true)
      }
    },
    onStatic: () => {
      sidebarPourDone()
      setPoured(true)
    },
  })

  const link = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      data-tour={item.tour}
      className={({ isActive }) => (isActive ? 'admin-nav-item active' : 'admin-nav-item')}
    >
      <Icon name={item.icon} size={18} className="admin-nav-icon" />
      <span className="admin-nav-label">{item.label}</span>
    </NavLink>
  )

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
    <div className={`admin-shell${drawer ? ' drawer-open' : ''}`}>
      <ShellPalette onLogout={() => setConfirmLogout(true)} />
      <GuideDrawer open={drawer} />
      <header className="admin-mobilebar">
        <button
          type="button"
          className="admin-menu-button"
          aria-expanded={drawer}
          aria-controls="admin-sidebar"
          onClick={() => setDrawer((o) => !o)}
        >
          <Icon name={drawer ? 'close' : 'menu'} size={20} />
          <span className="sr-only">{drawer ? 'Stäng menyn' : 'Meny'}</span>
        </button>
        <span className="admin-mobilebar-brand">
          <BrandWordmark height={18} />
        </span>
        <span className="admin-mobilebar-name">{tenant?.name ?? ''}</span>
      </header>
      {drawer && <div className="admin-drawer-scrim" aria-hidden="true" onClick={() => setDrawer(false)} />}
      <aside
        id="admin-sidebar"
        ref={sidebarRef}
        className={`admin-sidebar${poured ? ' admin-sidebar--full' : ' admin-sidebar--pouring'}`}
        onPointerMove={(e) => {
          if (poured || Math.random() > 0.2) return
          const rect = e.currentTarget.getBoundingClientRect()
          wall.touch((e.clientX - rect.left) / rect.width, 0.4)
        }}
      >
        {pour && <canvas ref={sidebarCanvas} className="admin-sidebar-liquid" aria-hidden="true" />}
        <div className="admin-logo">
          <span className="admin-logo-badge" aria-hidden="true">
            <BrandMark />
          </span>
          <span className="admin-logo-text">
            <span className="admin-logo-brand">
              <BrandWordmark height={22} />
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
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => navVisible(item, tenant))
            if (items.length === 0) return null
            const headingId = `nav-group-${group.id}`
            const listId = `nav-list-${group.id}`
            // Öppen från början; hopfälld bara om användaren har fällt ihop den.
            const open = !group.label || !closedGroups.includes(group.id)
            const links = items.map(link)
            return (
              <div
                key={group.id}
                className={open ? 'admin-nav-group' : 'admin-nav-group closed'}
                role={group.label ? 'group' : undefined}
                aria-labelledby={group.label ? headingId : undefined}
              >
                {group.label ? (
                  <>
                    <button
                      type="button"
                      className="admin-nav-heading admin-nav-toggle"
                      id={headingId}
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() => toggleGroup(group.id, open)}
                    >
                      {group.label}
                      <Icon name="chevron-down" size={14} className="admin-nav-chevron" />
                    </button>
                    <div className="admin-nav-items" id={listId}>
                      <div>{links}</div>
                    </div>
                  </>
                ) : (
                  links
                )}
              </div>
            )
          })}
        </nav>

        <div className="admin-sidebar-spacer" />

        <nav className="admin-nav admin-nav--bottom" aria-label="Inställningar och hjälp">
          {NAV_FOOTER.filter((item) => navVisible(item, tenant)).map(link)}
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
          <button
            type="button"
            className="admin-logout"
            aria-haspopup="dialog"
            onClick={() => setConfirmLogout(true)}
          >
            <Icon name="logout" size={16} />
            Logga ut
          </button>
        </div>
      </aside>
      {confirmLogout && <LogoutConfirm onConfirm={logout} onCancel={cancelLogout} />}

      <div className="admin-right">
        <BusyBar />
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
          <MotionScope>
            <DpaBanner />
            {/* Sidans kod hämtas när den öppnas (App.tsx); under tiden samma skelett som när restaurangen hämtas. */}
            <Suspense fallback={<div className="admin-main"><SkelPage label="Hämtar sidan"><SkelTiles /><SkelCard rows={5} /></SkelPage></div>}>
              <Outlet key={locationId ?? 'no-location'} />
            </Suspense>
          </MotionScope>
        ) : (
          <div className="admin-main">
            <SkelPage label="Hämtar restaurangen">
              <SkelTiles />
              <SkelCard rows={5} />
            </SkelPage>
          </div>
        )}
      </div>
    </div>
    </GuideProvider>
  )
}

/** Guiden pekar på menylänkar: på smala skärmar ligger menyn då öppen i flödet. */
function GuideDrawer({ open }: { open: boolean }) {
  const { active } = useGuide()
  useEffect(() => {
    document.documentElement.classList.toggle('guide-nav-open', active && !open)
    return () => document.documentElement.classList.remove('guide-nav-open')
  }, [active, open])
  return null
}

/** ⌘K: sidorna man får se, några åtgärder och de senast besökta sidorna. */
function ShellPalette({ onLogout }: { onLogout: () => void }) {
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { start } = useGuide()
  const items = useCallback((): PaletteItem[] => {
    const nav = visibleNav(tenant)
    const canBook = nav.some((n) => n.to === '/bokningar')
    const actions: PaletteItem[] = [
      ...(canBook
        ? [{ id: 'a-booking', group: 'Åtgärder' as const, label: 'Ny bokning', icon: 'plus' as const, keywords: 'boka bord gäst', run: () => { requestPageAction('new-booking'); navigate('/bokningar') } }]
        : []),
      { id: 'a-dish', group: 'Åtgärder', label: 'Lägg till rätt', icon: 'dish', keywords: 'meny mat', run: () => { requestPageAction('new-dish'); navigate('/meny') } },
      { id: 'a-look', group: 'Åtgärder', label: 'Utseende och ljud', hint: 'Inställningar', icon: 'gear', keywords: 'mörkt ljust tema klickljud', run: () => navigate('/installningar#utseende') },
      { id: 'a-guide', group: 'Åtgärder', label: 'Starta guiden', icon: 'help', keywords: 'hjälp introduktion', run: start },
      { id: 'a-logout', group: 'Åtgärder', label: 'Logga ut', icon: 'logout', run: onLogout },
    ]
    const goto: PaletteItem[] = nav.map((n) => ({ id: `n-${n.to}`, group: 'Gå till', label: n.label, icon: n.icon, run: () => navigate(n.to) }))
    const here = window.location.pathname
    const recent: PaletteItem[] = recentPages()
      .filter((p) => p !== here)
      .map((p) => nav.find((n) => onItem(p, n)))
      .filter((n): n is NavItem => Boolean(n))
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .slice(0, 4)
      .map((n) => ({ id: `r-${n.to}`, group: 'Senaste', label: n.label, icon: n.icon, run: () => navigate(n.to) }))
    return [...actions, ...goto, ...recent]
  }, [tenant, navigate, start, onLogout])
  return <CommandPalette items={items} />
}
