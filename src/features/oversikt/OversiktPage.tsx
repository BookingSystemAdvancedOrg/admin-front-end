import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { QuickLinkIcon } from './QuickLinkIcon'
import type { QuickLinkIconName } from './QuickLinkIcon'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { currentLocation, stripeStage, useTenant } from '../../shared/tenant'
import { getLocation } from '../installningar/locationApi'
import type { Location } from '../installningar/locationApi'
import { listMenuItems } from '../meny/menuApi'
import { listLayoutVersions } from '../layout-editor/layoutApi'
import { listUsers } from '../installningar/usersApi'
import { hasAnyOpeningHours, setupSteps, todaysHours } from './overview'
import { tableNames, useTables } from '../../shared/tables'
import {
  ACTIVE_STATUSES,
  STATUS_CLASS,
  STATUS_LABEL,
  listReservations,
  todayIn,
} from '../bokningar/bookingsApi'
import type { Reservation } from '../bokningar/bookingsApi'

// Genvägskorten längst ned som länkar till de andra sidorna.
const QUICK_LINKS: { to: string; icon: QuickLinkIconName; label: string }[] = [
  { to: '/meny', icon: 'menu', label: 'Hantera meny' },
  { to: '/layout', icon: 'layout', label: 'Redigera layout' },
  { to: '/bokningar', icon: 'bookings', label: 'Se alla bokningar' },
  { to: '/installningar', icon: 'settings', label: 'Inställningar' },
]

interface OverviewData {
  /** Platsen datan gäller — en annan plats betyder att ny data hämtas. */
  forLocation: string | null
  location: Location | null
  activeMenuItems: number | null
  hasLiveLayout: boolean | null
  staffCount: number | null
  /** Dagens bokningar (alla statusar); null = kunde inte hämtas. */
  today: Reservation[] | null
}

const EMPTY: OverviewData = {
  forLocation: null,
  location: null,
  activeMenuItems: null,
  hasLiveLayout: null,
  staffCount: null,
  today: null,
}

/** Ett anrop som misslyckas ger `null` (okänt) i stället för att fälla sidan. */
function orNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null)
}

/**
 * Figma: admin-oversikt-page (36:165).
 *
 * Allt på sidan är restaurangens riktiga data för den valda platsen. Tidigare
 * visades påhittade bokningar och nyckeltal här — det ger en ny kund fel
 * bild av sin egen restaurang. Där backend ännu saknar data (bokningar)
 * står det uttryckligen i stället för att visa exempel.
 */
export default function OversiktPage() {
  const tenantState = useTenant()
  const { tenant, locationId } = tenantState
  const location = currentLocation(tenantState)
  const { labels } = useTables(locationId)
  const isOwner = tenant?.role === 'owner_user'
  const [fetched, setFetched] = useState<OverviewData>(EMPTY)
  // Data för en annan plats än den valda visas aldrig, inte ens en stund.
  const loading = Boolean(locationId) && fetched.forLocation !== locationId
  const data = loading ? EMPTY : fetched
  const timezoneSetting = location?.timezone

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    Promise.all([
      orNull(getLocation(locationId)),
      orNull(listMenuItems(locationId)),
      isOwner ? orNull(listLayoutVersions(locationId)) : Promise.resolve(null),
      isOwner ? orNull(listUsers()) : Promise.resolve(null),
      orNull(listReservations(locationId, todayIn(timezoneSetting))),
    ]).then(([loc, menu, versions, users, today]) => {
      if (cancelled) return
      setFetched({
        forLocation: locationId,
        location: loc,
        activeMenuItems: menu ? menu.filter((m) => m.active).length : null,
        hasLiveLayout: versions ? versions.some((v) => v.isCurrent) : null,
        staffCount: users ? users.filter((u) => u.role === 'staff').length : null,
        today,
      })
    })
    return () => {
      cancelled = true
    }
  }, [locationId, isOwner, timezoneSetting])

  const stage = tenant ? stripeStage(tenant.stripe) : 'missing'
  const timezone = data.location?.timezone ?? location?.timezone ?? null
  const steps = setupSteps({
    isOwner,
    hasOpeningHours: data.location ? hasAnyOpeningHours(data.location.businessHours) : null,
    activeMenuItems: data.activeMenuItems,
    hasLiveLayout: data.hasLiveLayout,
    stripeStage: stage,
    staffCount: data.staffCount,
  })
  const remaining = steps.filter((s) => s.done === false).length
  // Visas när det finns något kvar (eller som inte gick att kontrollera).
  const showSetup = isOwner && !loading && steps.some((s) => s.done !== true)

  const todayActive = data.today
    ? data.today.filter((r) => ACTIVE_STATUSES.includes(r.status))
    : null

  const stats = [
    {
      label: 'Öppet idag',
      value: data.location ? todaysHours(data.location.businessHours, timezone) : '—',
      note: timezone ?? '',
    },
    {
      label: 'Rätter på menyn',
      value: data.activeMenuItems === null ? '—' : String(data.activeMenuItems),
      note: 'aktiva rätter',
    },
    {
      label: 'Kortbetalningar',
      value: stage === 'ready' ? 'Aktiva' : 'Ej aktiva',
      note: stage === 'ready' ? 'via Stripe' : 'Stripe är inte klart',
      danger: stage !== 'ready',
    },
    {
      label: 'Bokningar idag',
      value: todayActive === null ? '—' : String(todayActive.length),
      note:
        todayActive === null
          ? 'kunde inte hämtas'
          : `${todayActive.reduce((sum, r) => sum + r.partySize, 0)} gäster`,
    },
  ]

  if (!locationId) {
    return (
      <>
        <AdminTopbar title="Översikt" />
        <div className="admin-main">
          <section className="admin-card table-card">
            <h2 className="card-title">Välkommen{tenant ? `, ${tenant.name}` : ''}!</h2>
            <p className="cell-muted">
              {isOwner
                ? 'Restaurangen har ingen plats än. Börja med att lägga in restaurangens uppgifter under Inställningar.'
                : 'Du är inte kopplad till någon plats än. Be restaurangens ägare att koppla dig till en plats.'}
            </p>
            {isOwner && (
              <Link className="card-link" to="/installningar">
                Till inställningar →
              </Link>
            )}
          </section>
        </div>
      </>
    )
  }

  return (
    <>
      <AdminTopbar title="Översikt" />
      <div className="admin-main">
        <section className="stats-row" aria-label="Nyckeltal">
          {stats.map((stat) => (
            <article key={stat.label} className="admin-card stat-tile">
              <p className="stat-tile-label">{stat.label}</p>
              <p className={stat.danger ? 'stat-tile-value danger' : 'stat-tile-value'}>
                {loading && stat.value === '—' ? '…' : stat.value}
              </p>
              <p className="stat-tile-note">{stat.note}</p>
            </article>
          ))}
        </section>

        <div className="oversikt-row">
          <section className="admin-card bookings-card" aria-label="Dagens bokningar">
            <div className="card-head">
              <h2 className="card-title">Dagens bokningar</h2>
              <Link className="card-link" to="/bokningar">
                Visa alla →
              </Link>
            </div>
            {todayActive && todayActive.length > 0 ? (
              <ul className="today-list">
                {todayActive.slice(0, 8).map((r) => (
                  <li key={r.reservationId}>
                    <span className="cell-strong">{r.startTime}</span>
                    <span>
                      {r.customerName || 'Gäst'} · {r.partySize} pers · {tableNames(r.tableIds, labels)}
                    </span>
                    <span className={`status-badge ${STATUS_CLASS[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-empty">
                {loading
                  ? 'Hämtar…'
                  : todayActive === null
                    ? 'Kunde inte hämta dagens bokningar.'
                    : `Inga bokningar idag för ${location?.name || 'platsen'}.`}
              </p>
            )}
            {todayActive && todayActive.length > 8 && (
              <Link className="card-link" to="/bokningar">
                + {todayActive.length - 8} till
              </Link>
            )}
          </section>

        </div>

        <section className="quick-links-row" aria-label="Genvägar">
          {QUICK_LINKS.map((link) => (
            <Link key={link.to + link.label} className="admin-card quick-link" to={link.to}>
              <span className="quick-link-label">
                <span className="quick-link-icon" aria-hidden="true">
                  <QuickLinkIcon name={link.icon} />
                </span>
                {link.label}
              </span>
              <span className="quick-link-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </section>

        {/* Kom igång: bara ägaren, och bara tills allt är klart. */}
        {showSetup && (
        <section className="admin-card activity-card setup-card" aria-label="Kom igång" data-tour="getting-started">
          <div className="card-head">
            <h2 className="card-title">Kom igång</h2>
            {!loading && (
              <span className="cell-muted">
                {remaining === 0 ? 'Kunde inte kontrollera allt' : `${remaining} kvar`}
              </span>
            )}
          </div>
          {steps.map((step) => (
            <Link key={step.id} to={step.to} className="activity-item setup-step">
              <span className="activity-text">
                <span
                  className={`setup-check ${step.done ? 'done' : ''}`}
                  aria-hidden="true"
                >
                  {step.done ? '✓' : step.done === null ? '?' : ''}
                </span>
                {step.label}
              </span>
              <span className="activity-time">
                {loading
                  ? 'Kontrollerar…'
                  : step.done
                    ? 'Klart'
                    : step.done === null
                      ? 'Kunde inte kontrolleras'
                      : 'Att göra'}
              </span>
            </Link>
          ))}
        </section>
        )}
      </div>
    </>
  )
}
