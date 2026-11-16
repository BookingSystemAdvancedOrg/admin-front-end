import { useCallback, useEffect, useRef, useState } from 'react'
import { sameData, useLiveRefresh } from '../../shared/live'
import type { CSSProperties } from 'react'
import { Num } from '../../shared/motion/Num'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MonthCard } from './MonthCard'
import { StatTile } from './StatTile'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { currentLocation, stripeStage, useTenant } from '../../shared/tenant'
import { canOpen } from '../../shared/access'
import type { Area } from '../../shared/access'

import { getLocation } from '../installningar/locationApi'
import type { Location } from '../installningar/locationApi'
import { listMenuItems } from '../meny/menuApi'
import { listLayoutVersions } from '../layout-editor/layoutApi'
import { listUsers } from '../installningar/usersApi'
import {
  activeOrders,
  bookingsToday,
  clockIn,
  hasAnyOpeningHours,
  revenueToday,
  revenueUntil,
  setupSteps,
  todoQueue,
} from './overview'
import { kronor, listOrders } from '../bestallningar/ordersApi'
import type { Order } from '../bestallningar/ordersApi'
import { listRequests } from '../catering/cateringApi'
import type { RequestSummary } from '../catering/cateringApi'
import { getPrintStatus } from '../bestallningar/printApi'
import type { PrintStatus } from '../bestallningar/printApi'
import { tableNames, useTables } from '../../shared/tables'
import { TableLinks } from '../../shared/TableLinks'
import {
  ACTIVE_STATUSES,
  STATUS_CLASS,
  STATUS_LABEL,
  listReservations,
  todayIn,
} from '../bokningar/bookingsApi'
import type { Reservation } from '../bokningar/bookingsApi'
import { SAMPLE_REVENUE_LAST_WEEK, SAMPLE_TABLE_LABELS, sampleData, sampleModeOn, setSampleMode } from './sample'
import { addDays } from '../statistik/stats'
import { trendOf } from '../../shared/trend'
import type { Trend } from '../../shared/trend'
import { Icon } from '../../shared/Icon'
import type { IconName } from '../../shared/Icon'
import { Disclosure } from '../../shared/Disclosure'
import { SkelRows } from '../../shared/Skeleton'
import { getLocation as getPhoneLocation, getOverview as getPhoneOverview } from '../phone-agent/api'
import { progress as phoneProgress, type Progress } from '../phone-agent/setup'
import { getConnection as getGoogleConnection, getLocationView as getGoogleView, googleDone } from '../google-business/api'
import './setup.css'

// Genvägskorten längst ned som länkar till de andra sidorna. Ägaren får
// Statistik i stället för "Se alla bokningar" (dagens bokningar har redan
// "Visa alla" ovanför).
const QUICK_LINKS: { to: string; icon: IconName; label: string; ownerOnly?: boolean; staffOnly?: boolean; area?: Area }[] = [
  { to: '/statistik?period=month', icon: 'chart', label: 'Månadens statistik', ownerOnly: true },
  { to: '/meny', icon: 'book', label: 'Hantera meny', area: 'meny' },
  { to: '/layout', icon: 'tool-floor', label: 'Redigera layout', area: 'layout' },
  { to: '/bokningar', icon: 'calendar', label: 'Se alla bokningar', staffOnly: true, area: 'bokningar' },
  { to: '/installningar', icon: 'gear', label: 'Inställningar' },
]

interface OverviewData {
  /** Platsen datan gäller - en annan plats betyder att ny data hämtas. */
  forLocation: string | null
  location: Location | null
  activeMenuItems: number | null
  hasLiveLayout: boolean | null
  staffCount: number | null
  /** Dagens bokningar (alla statusar); null = kunde inte hämtas. */
  today: Reservation[] | null
  /** Dagens beställningar; null = saknas i planen eller kunde inte hämtas. */
  orders: Order[] | null
  /** Samma veckodag förra veckan, att jämföra dagens omsättning med. */
  ordersLastWeek: Order[] | null
  /** Cateringförfrågningar; null = saknas i planen eller kunde inte hämtas. */
  catering: RequestSummary[] | null
  /** Köksskrivarens läge; null = ingen beställning i planen eller kunde inte hämtas. */
  print: PrintStatus | null
  /** Telefonassistentens fem steg; null = ingår inte i planen eller kunde inte hämtas. */
  phone: Progress | null
  /** Google-profilen klar (kopplad eller överhoppad); null = ingår inte i planen eller kunde inte hämtas. */
  google: boolean | null
}

const EMPTY: OverviewData = {
  forLocation: null,
  location: null,
  activeMenuItems: null,
  hasLiveLayout: null,
  staffCount: null,
  today: null,
  orders: null,
  ordersLastWeek: null,
  catering: null,
  print: null,
  phone: null,
  google: null,
}

/** Ett anrop som misslyckas ger `null` (okänt) i stället för att fälla sidan. */
function orNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null)
}

/**
 * Figma: admin-oversikt-page (36:165).
 *
 * Allt på sidan är restaurangens riktiga data för den valda platsen. Tidigare
 * visades påhittade bokningar och nyckeltal här - det ger en ny kund fel
 * bild av sin egen restaurang. Där backend ännu saknar data (bokningar)
 * står det uttryckligen i stället för att visa exempel.
 *
 * Undantaget är exempelläget (sample.ts): den som vill se hur Översikten
 * ser ut en fullsatt kväll kan slå på det själv. Då byts dagens bokningar,
 * beställningar och cateringförfrågningar mot exempel, alla funktioner
 * visas, och en stämpel överst säger att siffrorna inte är riktiga.
 * Kom igång-listan och platsen är alltid de riktiga.
 */
export default function OversiktPage() {
  const tenantState = useTenant()
  const { tenant, locationId } = tenantState
  const location = currentLocation(tenantState)
  const { labels } = useTables(locationId)
  const isOwner = tenant?.role === 'owner_user'
  // Kommer man hit direkt efter att ha godkänt avtalet (AvtalPage) står en kvittens överst.
  const { state: navState, pathname: here } = useLocation()
  const navigate = useNavigate()
  const accepted = (navState as { dpaAccepted?: boolean; sitePublished?: boolean } | null) ?? null
  const [fetched, setFetched] = useState<OverviewData>(EMPTY)
  const [sample, setSample] = useState(sampleModeOn)
  const chooseSample = (on: boolean) => {
    setSampleMode(on)
    setSample(on)
  }
  // Data för en annan plats än den valda visas aldrig, inte ens en stund.
  const loading = Boolean(locationId) && fetched.forLocation !== locationId
  const timezoneSetting = location?.timezone
  const data: OverviewData = loading
    ? EMPTY
    : sample
      ? { ...fetched, ...sampleData(todayIn(timezoneSetting)) }
      : fetched
  // Personalen ser bara rutorna för de områden ägaren har gett dem (access.ts).
  const seeBookings = sample || canOpen(tenant, 'bokningar')
  const hasOrdering = sample || (Boolean(tenant?.entitlements.features.ordering) && canOpen(tenant, 'bestallningar'))
  const hasCatering = sample || (Boolean(tenant?.entitlements.features.catering) && canOpen(tenant, 'catering'))
  // Telefonassistenten i planen: ägarens Kom igång får ett steg med fem delsteg.
  const hasPhone = isOwner && Boolean(tenant?.entitlements.features.phoneAgent)
  // Google-profilen i planen: ett valfritt steg som går att hoppa över.
  const hasGoogle = isOwner && Boolean(tenant?.entitlements.features.googleBusiness)
  const tableLabels = sample ? (SAMPLE_TABLE_LABELS as Map<string, string>) : labels

  const fetchOverview = useCallback((locationId: string): Promise<OverviewData> =>
    Promise.all([
      orNull(getLocation(locationId)),
      orNull(listMenuItems(locationId)),
      isOwner ? orNull(listLayoutVersions(locationId)) : Promise.resolve(null),
      isOwner ? orNull(listUsers()) : Promise.resolve(null),
      seeBookings ? orNull(listReservations(locationId, todayIn(timezoneSetting))) : Promise.resolve(null),
      hasOrdering ? orNull(listOrders(locationId)) : Promise.resolve(null),
      hasCatering ? orNull(listRequests(locationId)) : Promise.resolve(null),
      hasOrdering ? orNull(listOrders(locationId, addDays(todayIn(timezoneSetting), -7))) : Promise.resolve(null),
      hasOrdering ? orNull(getPrintStatus(locationId)) : Promise.resolve(null),
      hasPhone
        ? orNull(Promise.all([getPhoneOverview(), getPhoneLocation(locationId)]).then(([o, l]) => phoneProgress(o.config, l)))
        : Promise.resolve(null),
      hasGoogle
        ? orNull(Promise.all([getGoogleConnection(), getGoogleView(locationId)]).then(([c, v]) => googleDone(c, v)))
        : Promise.resolve(null),
    ]).then(([loc, menu, versions, users, today, orders, catering, lastWeek, print, phone, google]) => ({
        forLocation: locationId,
        location: loc,
        activeMenuItems: menu ? menu.filter((m) => m.active).length : null,
        hasLiveLayout: versions ? versions.some((v) => v.isCurrent) : null,
        staffCount: users ? users.filter((u) => u.role === 'staff').length : null,
        today,
        orders: orders ? orders.orders : null,
        ordersLastWeek: lastWeek ? lastWeek.orders : null,
        catering,
        print,
        phone,
        google,
      })),
  [isOwner, timezoneSetting, seeBookings, hasOrdering, hasCatering, hasPhone, hasGoogle])

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    void fetchOverview(locationId).then((d) => {
      if (!cancelled) setFetched(d)
    })
    return () => {
      cancelled = true
    }
  }, [locationId, fetchOverview])
  // Försök igen i felrutan: hämta översikten på nytt.
  // Bara ett försök åt gången, och ett sent svar för en annan plats skriver aldrig över.
  const [retrying, setRetrying] = useState(false)
  const locationIdRef = useRef(locationId)
  useEffect(() => {
    locationIdRef.current = locationId
  }, [locationId])
  const retryOverview = () => {
    if (!locationId || retrying) return
    setRetrying(true)
    void fetchOverview(locationId)
      .then((d) => {
        if (d.forLocation === locationIdRef.current) setFetched(d)
      })
      .finally(() => setRetrying(false))
  }
  // Levande: dagens bokningar, beställningar och förfrågningar uppdateras av sig själva.
  useLiveRefresh(async () => {
    if (!locationId) return
    const d = await fetchOverview(locationId)
    setFetched((prev) => (prev.forLocation === d.forLocation && !sameData(prev, d) ? d : prev))
  }, { enabled: Boolean(locationId) && !loading && !sample })

  const stage = tenant ? stripeStage(tenant.stripe) : 'missing'
  const timezone = data.location?.timezone ?? location?.timezone ?? null
  const steps = setupSteps({
    isOwner,
    hasOpeningHours: data.location ? hasAnyOpeningHours(data.location.businessHours) : null,
    activeMenuItems: data.activeMenuItems,
    hasLiveLayout: data.hasLiveLayout,
    stripeStage: stage,
    staffCount: data.staffCount,
    dpaAccepted: tenant?.dpa ? tenant.dpa.upToDate : undefined,
    google: hasGoogle ? data.google : undefined,
    phone: hasPhone ? data.phone : undefined,
  })
  const remaining = steps.filter((s) => s.done === false).length
  // Kom igång (bara ägaren): direkt under nyckeltalen så länge något är kvar
  // (eller inte gick att kontrollera), längst ned som liten bekräftelse när
  // allt är klart. Nyckeltalen står alltid först: "hur går dagen, vad
  // behöver mig nu" ska synas utan att scrolla, även på telefonen.
  const setupIncomplete = isOwner && !loading && steps.some((s) => s.done !== true)
  const setupComplete = isOwner && !loading && steps.every((s) => s.done === true)

  const stepItem = (step: (typeof steps)[number]) => (
    <Link key={step.id} to={step.to} className="activity-item setup-step">
      <span className="activity-text">
        <span className={`setup-check ${step.done ? 'done' : ''}`} aria-hidden="true">
          {step.done ? <Icon name="check" size={14} /> : step.done === null ? '?' : ''}
        </span>
        <span className="setup-step__label">
          {step.label}
          {step.sub ? (
            <span className="setup-sub" aria-label={`${step.sub.filter((x) => x.done).length} av ${step.sub.length} delsteg klara`}>
              {step.sub.map((x) => (
                <span key={x.label} className={`setup-sub__item${x.done ? ' done' : ''}`}>
                  {x.done ? <Icon name="check" size={12} /> : null}
                  {x.label}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </span>
      <span className="activity-time">
        {step.done ? 'Klart' : step.done === null ? 'Kunde inte kontrolleras' : 'Att göra'}
      </span>
    </Link>
  )
  const setupList = steps.map(stepItem)
  // Medan något är kvar visas bara det som är kvar, så att dagens bokningar inte trycks ned.
  const pendingList = steps.filter((s) => s.done !== true).map(stepItem)
  const doneCount = steps.length - pendingList.length

  const todayActive = data.today
    ? data.today.filter((r) => ACTIVE_STATUSES.includes(r.status))
    : null

  // Nyckeltalen överst, i den ordning restaurangen tittar (docs/DASHBOARD.md):
  // det som väntar, dagens gäster, köket och sist pengarna. Varje ruta är en
  // länk dit man åtgärdar saken. Utan beställning i planen visas bara de två
  // första, i stället för två rutor med "ingår inte".
  const bookings = bookingsToday(data.today, clockIn(timezone))
  const revenue = revenueToday(data.orders)
  // Dagen hittills mot samma veckodag förra veckan fram till samma klockslag.
  const revenueBefore = sample ? SAMPLE_REVENUE_LAST_WEEK : revenueUntil(data.ordersLastWeek, clockIn(timezone), timezone)
  const inProgress = activeOrders(data.orders)
  const todo = todoQueue(data.today, data.catering, sample ? null : data.print)

  const stats: {
    label: string
    value: string
    to: string
    tone?: 'attention'
    trend?: Trend
  }[] = [
    ...(seeBookings || hasOrdering || hasCatering
      ? [{
          label: 'Att hantera',
          value: todo ? String(todo.total) : '-',
          // Till det mest brådskande först.
          to: todo?.items[0]?.to ?? (seeBookings ? '/bokningar' : hasOrdering ? '/bestallningar' : '/catering'),
          tone: todo && todo.total > 0 ? ('attention' as const) : undefined,
        }]
      : []),
    ...(seeBookings
      ? [{
          label: 'Bokningar idag',
          value: bookings ? String(bookings.count) : '-',
          to: '/bokningar',
        }]
      : []),
    ...(hasOrdering
      ? [
        {
          label: 'Aktiva beställningar',
          value: inProgress ? String(inProgress.count) : '-',
          to: '/bestallningar',
        },
        {
          label: 'Dagens omsättning',
          value: revenue ? kronor(revenue.amount) : '-',
          to: '/bestallningar',
          trend: revenue ? trendOf(revenue.amount, revenueBefore, 'revenue', 'samma tid förra veckan') : undefined,
        },
        ]
      : []),
  ]

  const acceptedNotice = accepted?.dpaAccepted ? (
    <div className="done-notice" role="status">
      <Icon name="check" size={18} />
      <span>
        Avtalet är godkänt.
      </span>
      <button type="button" className="link-action" onClick={() => navigate(here, { replace: true, state: null })}>
        Stäng
      </button>
    </div>
  ) : null

  if (!locationId) {
    return (
      <>
        <AdminTopbar title="Översikt" />
        <div className="admin-main">
          {acceptedNotice}
          <section className="admin-card table-card">
            <h2 className="card-title">Välkommen{tenant ? `, ${tenant.name}` : ''}!</h2>
            {!isOwner && <p className="cell-muted">Ingen plats än. Fråga ägaren.</p>}
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
        {sample && (
          <div className="sample-notice" role="status">
            <span className="sample-stamp">Exempel</span>
            <span>Exempeldata</span>
            <button type="button" className="link-action" onClick={() => chooseSample(false)}>
              Visa riktiga siffror
            </button>
          </div>
        )}
        {acceptedNotice}
        {stats.length > 0 && (
          <section className="stats-row" aria-label="Idag" style={{ '--stat-cols': stats.length } as CSSProperties}>
            {stats.map((stat, i) => (
              <StatTile key={stat.label} {...stat} loading={loading} index={i} />
            ))}
          </section>
        )}

        {setupIncomplete && (
          <section className="admin-card activity-card setup-card" aria-label="Kom igång" data-tour="getting-started">
            <div className="card-head">
              <div>
                <h2 className="card-title">Kom igång</h2>
              </div>
              <span className="cell-muted">
                {remaining === 0 ? 'Kunde inte kontrollera allt' : <><Num>{doneCount}</Num> av {steps.length} klara</>}
              </span>
            </div>
            {pendingList}
          </section>
        )}

        {seeBookings && <div className="oversikt-row">
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
                      {r.customerName || 'Gäst'} · <Num>{r.partySize}</Num> pers · {sample ? tableNames(r.tableIds, tableLabels) : <TableLinks ids={r.tableIds} labels={tableLabels} date={r.date} />}
                    </span>
                    <span className={`status-badge ${STATUS_CLASS[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : loading || retrying ? (
              <SkelRows n={3} cols={3} />
            ) : todayActive === null ? (
              <ErrorNote text={booqyFaultText('Kunde inte hämta dagens bokningar.')} onRetry={retryOverview} />
            ) : (
              <p className="admin-empty">
                Inga bokningar idag.
                <button type="button" className="sample-offer" onClick={() => chooseSample(true)}>
                  Visa med exempeldata
                </button>
              </p>
            )}
            {todayActive && todayActive.length > 8 && (
              <Link className="card-link" to="/bokningar">
                + {todayActive.length - 8} till
              </Link>
            )}
          </section>

        </div>}

        {isOwner && (
          <MonthCard
            locationId={locationId}
            today={todayIn(timezoneSetting)}
            sample={sample}
            showRevenue={hasOrdering || hasCatering}
          />
        )}

        <Disclosure title="Genvägar" className="ds-acc--line">
          <section className="quick-links-row" aria-label="Genvägar">
            {QUICK_LINKS.filter((link) => (link.ownerOnly ? isOwner : link.staffOnly ? !isOwner : true) && (!link.area || canOpen(tenant, link.area))).map((link) => (
              <Link key={link.to + link.label} className="admin-card quick-link" to={link.to}>
                <span className="quick-link-label">
                  <span className="quick-link-icon" aria-hidden="true">
                    <Icon name={link.icon} size={20} />
                  </span>
                  {link.label}
                </span>
                <Icon name="arrow-right" size={18} className="quick-link-arrow" />
              </Link>
            ))}
          </section>
        </Disclosure>

        {setupComplete && (
          <details className="admin-card setup-card setup-card--done" data-tour="getting-started">
            <summary className="setup-done-summary">
              <span className="setup-check done" aria-hidden="true"><Icon name="check" size={14} /></span>
              <span>Kom igång: allt är klart</span>
              <span className="cell-muted setup-done-toggle">Visa stegen</span>
            </summary>
            <div className="setup-done-list">{setupList}</div>
          </details>
        )}
      </div>
    </>
  )
}
