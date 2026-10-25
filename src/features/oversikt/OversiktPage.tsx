import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Num } from '../../shared/motion/Num'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { QuickLinkIcon } from './QuickLinkIcon'
import { MonthCard } from './MonthCard'
import { StatTile } from './StatTile'
import type { QuickLinkIconName } from './QuickLinkIcon'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { currentLocation, stripeStage, useTenant } from '../../shared/tenant'
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
import {
  ACTIVE_STATUSES,
  STATUS_CLASS,
  STATUS_LABEL,
  listReservations,
  todayIn,
} from '../bokningar/bookingsApi'
import type { Reservation } from '../bokningar/bookingsApi'
import { Loading } from '../../shared/Loading'
import { SAMPLE_REVENUE_LAST_WEEK, SAMPLE_TABLE_LABELS, sampleData, sampleModeOn, setSampleMode } from './sample'
import { addDays } from '../statistik/stats'
import { trendOf } from '../../shared/trend'
import type { Trend } from '../../shared/trend'
import { Icon } from '../../shared/Icon'

// Genvägskorten längst ned som länkar till de andra sidorna. Ägaren får
// Statistik i stället för "Se alla bokningar" (dagens bokningar har redan
// "Visa alla" ovanför).
const QUICK_LINKS: { to: string; icon: QuickLinkIconName; label: string; ownerOnly?: boolean; staffOnly?: boolean }[] = [
  { to: '/statistik?period=month', icon: 'stats', label: 'Månadens statistik', ownerOnly: true },
  { to: '/meny', icon: 'menu', label: 'Hantera meny' },
  { to: '/layout', icon: 'layout', label: 'Redigera layout' },
  { to: '/bokningar', icon: 'bookings', label: 'Se alla bokningar', staffOnly: true },
  { to: '/installningar', icon: 'settings', label: 'Inställningar' },
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
  const hasOrdering = sample || Boolean(tenant?.entitlements.features.ordering)
  const hasCatering = sample || Boolean(tenant?.entitlements.features.catering)
  const tableLabels = sample ? (SAMPLE_TABLE_LABELS as Map<string, string>) : labels

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    Promise.all([
      orNull(getLocation(locationId)),
      orNull(listMenuItems(locationId)),
      isOwner ? orNull(listLayoutVersions(locationId)) : Promise.resolve(null),
      isOwner ? orNull(listUsers()) : Promise.resolve(null),
      orNull(listReservations(locationId, todayIn(timezoneSetting))),
      hasOrdering ? orNull(listOrders(locationId)) : Promise.resolve(null),
      hasCatering ? orNull(listRequests(locationId)) : Promise.resolve(null),
      hasOrdering ? orNull(listOrders(locationId, addDays(todayIn(timezoneSetting), -7))) : Promise.resolve(null),
      hasOrdering ? orNull(getPrintStatus(locationId)) : Promise.resolve(null),
    ]).then(([loc, menu, versions, users, today, orders, catering, lastWeek, print]) => {
      if (cancelled) return
      setFetched({
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
      })
    })
    return () => {
      cancelled = true
    }
  }, [locationId, isOwner, timezoneSetting, hasOrdering, hasCatering])

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
        {step.label}
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
    note: string
    action: string
    to: string
    tone?: 'attention'
    trend?: Trend
  }[] = [
    {
      label: 'Att hantera',
      value: todo ? String(todo.total) : '-',
      note: !todo
        ? 'Kunde inte hämtas'
        : todo.total === 0
          ? 'Inget väntar - bra jobbat!'
          : todo.items.map((i) => `${i.count} ${i.label}`).join(' · '),
      action: todo && todo.total > 0 ? 'Ta det viktigaste först' : 'Allt är hanterat',
      // Till det mest brådskande först.
      to: todo?.items[0]?.to ?? '/bokningar',
      tone: todo && todo.total > 0 ? 'attention' : undefined,
    },
    {
      label: 'Bokningar idag',
      value: bookings ? String(bookings.count) : '-',
      note: !bookings
        ? 'Kunde inte hämtas'
        : bookings.next
          ? `${bookings.guests} gäster · nästa ${bookings.next.startTime}, ${bookings.next.customerName || 'gäst'} (${bookings.next.partySize} pers)`
          : `${bookings.guests} gäster · inga fler gäster idag`,
      action: 'Se dagens bokningar',
      to: '/bokningar',
    },
    ...(hasOrdering
      ? [
        {
          label: 'Aktiva beställningar',
          value: inProgress ? String(inProgress.count) : '-',
          note: !inProgress
            ? 'Kunde inte hämtas'
            : inProgress.count === 0
              ? 'Inga pågående just nu'
              : `${inProgress.fresh} nya · ${inProgress.preparing} tillagas · ${inProgress.ready} klara`,
          action: 'Öppna beställningar',
          to: '/bestallningar',
        },
        {
          label: 'Dagens omsättning',
          value: revenue ? kronor(revenue.amount) : '-',
          note: revenue ? `${revenue.count} betalda beställningar` : 'Kunde inte hämtas',
          action: 'Se försäljningen',
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
        Avtalet är godkänt{accepted.sitePublished ? ' och er webbplats kan nu publiceras' : ''}.
        {!locationId
          ? ' Fortsätt med restaurangens uppgifter nedan.'
          : loading
            ? ''
            : setupIncomplete
              ? ' Fortsätt med stegen nedan.'
              : ' Allt är klart för gästerna.'}
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
        {sample && (
          <div className="sample-notice" role="status">
            <span className="sample-stamp">Exempel</span>
            <span>Du ser exempeldata, inte restaurangens riktiga siffror.</span>
            <button type="button" className="link-action" onClick={() => chooseSample(false)}>
              Visa riktiga siffror
            </button>
          </div>
        )}
        {acceptedNotice}
        <section className="stats-row" aria-label="Idag" style={{ '--stat-cols': stats.length } as CSSProperties}>
          {stats.map((stat, i) => (
            <StatTile key={stat.label} {...stat} loading={loading} index={i} />
          ))}
        </section>

        {setupIncomplete && (
          <section className="admin-card activity-card setup-card" aria-label="Kom igång" data-tour="getting-started">
            <div className="card-head">
              <div>
                <h2 className="card-title">Kom igång</h2>
                <p className="cell-muted setup-lead">Gör klart de här stegen så att gästerna kan boka och beställa.</p>
              </div>
              <span className="cell-muted">
                {remaining === 0 ? 'Kunde inte kontrollera allt' : <><Num>{doneCount}</Num> av {steps.length} klara</>}
              </span>
            </div>
            {pendingList}
          </section>
        )}

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
                      {r.customerName || 'Gäst'} · <Num>{r.partySize}</Num> pers · {tableNames(r.tableIds, tableLabels)}
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
                  ? <Loading variant="inline" />
                  : todayActive === null
                    ? 'Kunde inte hämta dagens bokningar.'
                    : (
                      <>
                        Inga bokningar idag för {location?.name || 'platsen'}.
                        <button type="button" className="sample-offer" onClick={() => chooseSample(true)}>
                          Visa med exempeldata
                        </button>
                      </>
                    )}
              </p>
            )}
            {todayActive && todayActive.length > 8 && (
              <Link className="card-link" to="/bokningar">
                + {todayActive.length - 8} till
              </Link>
            )}
          </section>

        </div>

        {isOwner && (
          <MonthCard
            locationId={locationId}
            today={todayIn(timezoneSetting)}
            sample={sample}
            showRevenue={hasOrdering || hasCatering}
          />
        )}

        <section className="quick-links-row" aria-label="Genvägar">
          {QUICK_LINKS.filter((link) => (link.ownerOnly ? isOwner : link.staffOnly ? !isOwner : true)).map((link) => (
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
