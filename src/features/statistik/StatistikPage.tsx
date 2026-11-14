import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { Disclosure } from '../../shared/Disclosure'
import { revealSection } from '../../shared/reveal'
import { isApiConfigured } from '../../shared/api'
import { TrendBadge } from '../../shared/TrendBadge'
import { trendOf } from '../../shared/trend'
import type { TrendMetric } from '../../shared/trend'
import { STATISTIK_OPEN_KEY_PREFIX } from '../../shared/storageRegistry'
import { canSeeInsights, currentLocation, useTenant } from '../../shared/tenant'
import { Slot } from '../../shared/slots'
import { todayIn } from '../bokningar/bookingsApi'
import { channelLabel } from '../marknadsforing/marketingApi'
import { sampleModeOn, setSampleMode } from '../oversikt/sample'
import { BarChart, ColumnChart, Heatmap, Ring } from './charts'
import {
  CHANNELS,
  COMPARES,
  LEAD_LABELS,
  MAX_DAYS,
  PRESETS,
  SERVICES,
  SIZE_LABELS,
  WEEKDAY_LABELS,
  activeFilterCount,
  compareLabel,
  csvFileName,
  filtersFrom,
  filtersToParams,
  hourLabel,
  leadSoonPct,
  presetRange,
  signals,
  toCsv,
} from './insights'
import type { Filters, InsightsResponse, InsightsSummary, PresetId } from './insights'
import { fetchInsights, insightsQuery } from './insightsApi'
import { sampleInsights } from './insightsSample'
import { Overview } from './Overview'
import { Card, Tile, Tip } from './parts'
import { useLiveRefresh } from './live'
import { addDays, daysBetween, deltaPct, fmtDecimal, fmtInt, fmtKr, fmtPct, insightTitle, rangeLabel, shortDate } from './stats'
import './statistik.css'
import { DateInput } from '../../shared/DateInput'
import { SkelBlock, SkelBox, SkelCard, SkelPage } from '../../shared/Skeleton'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'

/**
 * Statistik: överst det viktigaste, alltid live (Overview: idag, kommande
 * bokningar, gäster per vecka, uteblivna). Under Fördjupning restaurangens
 * siffror för en vald period i hopfällda avsnitt: nyckeltal och Att göra,
 * omsättning, gäster, beläggning, meny, catering, hemsidan. Vilka avsnitt
 * som är utfällda minns sidan per användare. Varje siffra har en förklaring
 * (i), varje diagram en rad "Gör så här" och en tabell bakom.
 *
 * Ett anrop (GET /insights) räknar hela perioden och jämförelsen på
 * servern, även ett helt år. Filtren står i adressen, så en länk, ett
 * bokmärke och en omladdning visar samma sak. Ägaren ser allt; personalen
 * ser sin plats utan belopp när ägaren tillåter det (Inställningar,
 * Statistik). I exempelläget och lokalt utan API visas en påhittad
 * restaurang.
 */

interface Loaded {
  key: string
  data: InsightsResponse
}

const SECTIONS = [
  { id: 'nyckeltal', label: 'Nyckeltal' },
  { id: 'omsattning', label: 'Omsättning' },
  { id: 'gaster', label: 'Gäster' },
  { id: 'belaggning', label: 'Beläggning' },
  { id: 'meny', label: 'Beställningar och meny' },
  { id: 'catering', label: 'Catering' },
  { id: 'hemsidan', label: 'Hemsidan' },
]

function readOpen(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function StatistikPage() {
  const tenantState = useTenant()
  const { tenant, locationId } = tenantState
  const location = currentLocation(tenantState)
  const isOwner = tenant?.role === 'owner_user'
  const allowed = canSeeInsights(tenant)
  const features = tenant?.entitlements.features ?? {}
  const locations = tenant?.locations ?? []
  const multi = isOwner && locations.length > 1
  const defaultLocation = multi ? 'all' : (locationId ?? '')
  const [sample, setSample] = useState(sampleModeOn)
  const chooseSample = (on: boolean) => {
    setSampleMode(on)
    setSample(on)
  }
  const today = todayIn(location?.timezone ?? null)
  const [params, setParams] = useSearchParams()
  const f = filtersFrom(params, today, defaultLocation)
  const setFilters = (next: Partial<Filters>) => {
    const merged = { ...f, ...next }
    if (next.preset && next.preset !== 'custom') Object.assign(merged, presetRange(next.preset, today))
    setParams(filtersToParams(merged, defaultLocation), { replace: true })
  }
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [tick, setTick] = useState(0)
  // Utfällda avsnitt under Fördjupning, per användare i den här webbläsaren.
  const openKey = `${STATISTIK_OPEN_KEY_PREFIX}${tenantState.sub ?? 'du'}`
  const [open, setOpen] = useState<string[]>(() => readOpen(openKey))
  const toggle = (id: string) => (isOpen: boolean) => {
    setOpen((prev) => {
      const next = isOpen ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
      try {
        localStorage.setItem(openKey, JSON.stringify(next))
      } catch {
        // privat läge eller full lagring: valet gäller bara nu
      }
      return next
    })
  }
  const offline = !isApiConfigured()
  const showSample = sample || offline
  const key = `${insightsQuery(f)}|${showSample ? 'sample' : 'live'}|${isOwner ? 'o' : 's'}`

  const { from, to, service, channel, compare } = f
  const target = f.locationId
  // Exemplet räknas direkt i webbläsaren; bara riktiga siffror hämtas.
  const sampleName = target === 'all' ? 'Alla platser' : (locations.find((l) => l.locationId === target)?.name ?? 'Exempelrestaurangen')
  const sampleData =
    showSample && allowed && target
      ? sampleInsights({ preset: 'custom', from, to, locationId: target, service, channel, compare }, today, isOwner, sampleName)
      : null

  // Når perioden idag räknas den om efter varje ändring, när fliken syns igen och varje minut.
  useLiveRefresh(() => setTick((n) => n + 1), allowed && !showSample && to >= today)

  useEffect(() => {
    if (!allowed || !target || showSample) return
    let cancelled = false
    fetchInsights({ from, to, locationId: target, service, channel, compare }, { fresh: tick > 0 })
      .then((data) => !cancelled && setLoaded({ key, data }))
      .catch(() => !cancelled && setErrorKey(key))
    return () => {
      cancelled = true
    }
  }, [key, tick, allowed, showSample, target, from, to, service, channel, compare])

  if (!allowed) {
    return (
      <>
        <AdminTopbar title="Statistik" />
        <div className="admin-main">
          <section className="admin-card table-card tenant-notice">
            <h2 className="card-title">Bara för ägaren</h2>
          </section>
        </div>
      </>
    )
  }

  if (!locationId) {
    return (
      <>
        <AdminTopbar title="Statistik" />
        <div className="admin-main">
          <section className="admin-card table-card tenant-notice">
            <h2 className="card-title">Ingen plats än</h2>
            <Link className="card-link" to="/installningar">
              Till inställningar →
            </Link>
          </section>
        </div>
      </>
    )
  }

  const ready = sampleData ?? (loaded?.key === key ? loaded.data : null)
  const error = errorKey === key && !ready
  const s = ready?.current ?? null
  const p = ready?.previous ?? null
  const money = ready?.money ?? isOwner
  const cmp = compareLabel(f.compare)
  const comparing = f.compare !== 'none'
  const versus = (cur: number | null | undefined, prev: number | null | undefined, metric: TrendMetric) =>
    comparing ? { trend: prev == null ? null : trendOf(cur, prev, metric, cmp), against: cmp } : {}
  const days = daysBetween(f.from, f.to)
  const split = Number((ready?.locations.find((l) => l.locationId === f.locationId) ?? ready?.locations[0])?.lunchUntil?.slice(0, 2) ?? 15)
  const todo = s ? signals(s, p, { split, marketing: Boolean(features.marketing) }) : []
  const nothing = s !== null && s.bookings + s.cancelled + s.orders + s.catering.requests === 0
  const locationName = f.locationId === 'all' ? null : (locations.find((l) => l.locationId === f.locationId)?.name ?? location?.name ?? null)
  const filterCount = activeFilterCount(f, defaultLocation)
  const showOrders = Boolean(features.ordering) || (s?.orders ?? 0) > 0
  const showCatering = Boolean(features.catering) || (s?.catering.requests ?? 0) > 0
  const showWeb = Boolean(features.marketing) || (s?.web.visits ?? 0) > 0
  const heatHours = s ? [...new Set(s.heat.map((c) => c.hour))].sort((a, b) => a - b) : []
  const heatDays = s ? [...new Set(s.heat.map((c) => c.weekday))].sort((a, b) => a - b) : []
  const peakHour = s?.byHour.reduce<InsightsSummary['byHour'][number] | null>((best, h) => (!best || h.bookings > best.bookings ? h : best), null)
  // Veckodagar: bara de som finns i perioden, i snitt per dag (en veckodag
  // som förekommer en gång till ska inte se tyngre ut för det).
  const weekdays = (s?.byWeekday ?? []).filter((d) => d.days > 0).map((d) => ({ ...d, avgGuests: d.guests / d.days }))
  const openWeekdays = weekdays.filter((d) => d.occupancy !== null)
  const peakDay = weekdays.reduce<(typeof weekdays)[number] | null>((best, d) => (!best || d.avgGuests > best.avgGuests ? d : best), null)
  const lowDay = openWeekdays.reduce<(typeof openWeekdays)[number] | null>((low, d) => (!low || (d.occupancy ?? 0) < (low.occupancy ?? 0) ? d : low), null)
  const leadSoon = s ? leadSoonPct(s) : null
  const unmarked = s ? Math.max(0, s.bookings - s.arrived - s.noShows) : 0
  const sourced = s ? s.sources.online + s.sources.phone + s.sources.onsite : 0
  const prevByDay = (i: number) => (p && p.byDay.length === s?.byDay.length ? p.byDay[i] : undefined)
  const sizeRows = s?.bySize ?? []
  const lowSize = sizeRows.reduce<(typeof sizeRows)[number] | null>((low, r) => (r.occupancy !== null && (!low || (low.occupancy ?? 101) > r.occupancy) ? r : low), null)
  const topDishes = s?.dishes.slice(0, 10) ?? []
  const bottomDishes = s && s.dishes.length > 12 ? [...s.dishes].slice(-5).reverse() : []

  // Nyckeltalen överst. Ägaren ser pengarna först (omsättning, bokningar,
  // snittorder, uteblivna), personalen driften; se docs/DASHBOARD.md.
  const kpiTiles: Record<string, ReactNode> | null = s && {
    revenue: (
      <Tile
        key="revenue"
        label="Omsättning"
        value={fmtKr(s.revenue)}
        info="Betalda beställningar och levererad catering i perioden, inklusive moms. Bara ägaren ser beloppen."
        detail={`I perioden: beställningar ${fmtKr(s.orderRevenue)}, catering ${fmtKr(s.cateringRevenue)}`}
        {...versus(s.revenue, p?.revenue, 'revenue')}
      />
    ),
    bookings: (
      <Tile
        key="bookings"
        label="Bokningar"
        value={fmtInt(s.bookings)}
        info="Bokningar för dagar i perioden som inte är avbokade (räknas på besöksdagen). Uteblivna räknas med, påbörjade bokningar som aldrig blev klara inte."
        detail={`I perioden: ${fmtInt(s.cancelled)} avbokade, ${fmtInt(s.lateCancels)} sent`}
        {...versus(s.bookings, p?.bookings, 'bookings')}
      />
    ),
    guests: (
      <Tile
        key="guests"
        label="Gäster"
        value={fmtInt(s.guests)}
        info="Antal personer i bokningarna ovan (sällskapens storlek) på besöksdagen. Avbokade räknas inte."
        detail={s.avgParty ? `I perioden: ${fmtDecimal(s.avgParty)} per sällskap` : undefined}
        {...versus(s.guests, p?.guests, 'guests')}
      />
    ),
    avgOrder: (
      <Tile
        key="avgOrder"
        label="Snittorder"
        value={fmtKr(s.avgOrder)}
        info="Betalt belopp per onlinebeställning (avhämtning och vid bordet) i perioden."
        detail={`I perioden: ${fmtInt(s.orders)} betalda beställningar`}
        {...versus(s.avgOrder, p?.avgOrder, 'avgOrder')}
      />
    ),
    noShows: (
      <Tile
        key="noShows"
        label="Uteblivna"
        value={fmtPct(s.noShowPct ?? 0)}
        info="Bokningar som markerats som Kom inte, delat med alla bokningar i perioden som inte avbokats. Dagens kommande bokningar räknas med i nämnaren."
        detail={
          money && s.feeCount > 0
            ? `I perioden: ${fmtInt(s.noShows)} bokningar, ${fmtKr(s.feesCharged)} i avgifter`
            : `I perioden: ${fmtInt(s.noShows)} av ${fmtInt(s.bookings)} bokningar`
        }
        tone={s.noShowPct !== null && s.noShowPct >= 10 ? 'bad' : s.noShowPct !== null && s.noShowPct >= 5 ? 'warn' : undefined}
        {...versus(s.noShowPct, p?.noShowPct, 'noShows')}
      />
    ),
    occupancy: (
      <Tile
        key="occupancy"
        label="Beläggning"
        value={fmtPct(s.occupancy)}
        info="Bokad bordstid delat med all bordstid under öppettiderna i perioden. 100 % betyder att alla bord var bokade hela tiden."
        detail={s.seatFill !== null ? `I perioden: ${fmtPct(s.seatFill)} av stolarna` : undefined}
        {...versus(s.occupancy, p?.occupancy, 'occupancy')}
      />
    ),
    orders: (
      <Tile key="orders" label="Beställningar" info="Betalda onlinebeställningar i perioden, avhämtning och vid bordet." value={fmtInt(s.orders)} detail={`I perioden: ${fmtInt(s.tableOrders)} vid bordet`} {...versus(s.orders, p?.orders, 'orders')} />
    ),
    prepTime: (
      <Tile
        key="prepTime"
        label="Tillagningstid"
        value={s.prepMinutes !== null ? `${fmtDecimal(s.prepMinutes)} min` : '-'}
        info="Minuter från att köket bekräftade beställningen till att den markerades som klar, i snitt."
        detail={s.latePct !== null ? `I perioden: ${fmtPct(s.latePct)} sena` : undefined}
        {...versus(s.prepMinutes, p?.prepMinutes, 'prepTime')}
      />
    ),
  }
  const kpiOrder = money
    ? ['revenue', 'bookings', 'guests', 'avgOrder', 'noShows', 'occupancy']
    : ['guests', 'bookings', 'occupancy', 'noShows', 'orders', 'prepTime']

  return (
    <>
      <AdminTopbar title="Statistik" />
      <div className="admin-main sk-page">
        {showSample && (
          <div className="sample-notice" role="status">
            <span className="sample-stamp">Exempel</span>
            <span>Exempeldata</span>
            {sample && !offline && (
              <button type="button" className="link-action" onClick={() => chooseSample(false)}>
                Visa riktiga siffror
              </button>
            )}
          </div>
        )}
        {target && (
          <Overview locationId={target} today={today} money={isOwner} sample={showSample} sampleName={sampleName} />
        )}

        <div className="sk-deep-head">
          <h2 className="sk-block-title" id="sk-deep">
            Fördjupning
          </h2>
          <InfoTooltip label="Så räknas siffrorna">
            Bokningar räknas på dagen för besöket, beställningar på dagen de betalades, catering på leveransdagen. Belopp inklusive moms.
            Lunch är före klockan {String(split).padStart(2, '0')}:00.{' '}
            {ready?.builtAt ? `Sammanställt ${new Date(ready.builtAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}, idag räknas direkt.` : ''}
          </InfoTooltip>
        </div>
        <div className="sk-filterbar">
          <div className="sk-chips" role="group" aria-label="Period">
            {PRESETS.map((pr) => (
              <button
                key={pr.id}
                type="button"
                className="sk-chip"
                aria-pressed={f.preset === pr.id}
                onClick={() => setFilters(pr.id === 'custom' ? { preset: 'custom', from: f.from, to: f.to } : { preset: pr.id as PresetId })}
              >
                {pr.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="sk-filter-toggle"
            aria-expanded={filtersOpen}
            aria-controls="sk-filters"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Filter{filterCount > 0 ? ` (${filterCount})` : ''}
          </button>
          <div id="sk-filters" className={`sk-filters${filtersOpen ? ' is-open' : ''}`}>
            {f.preset === 'custom' && (
              <div className="sk-dates">
                <label className="sk-field">
                  <span>Från</span>
                  <DateInput
                    value={f.from}
                    max={f.to}
                    min={addDays(f.to, -(MAX_DAYS - 1))}
                    onChange={(e) => e.target.value && setFilters({ from: e.target.value > f.to ? f.to : e.target.value })}
                  />
                </label>
                <label className="sk-field">
                  <span>Till</span>
                  <DateInput
                    value={f.to}
                    min={f.from}
                    max={today}
                    onChange={(e) => e.target.value && setFilters({ to: e.target.value < f.from ? f.from : e.target.value })}
                  />
                </label>
              </div>
            )}
            {multi && (
              <label className="sk-field">
                <span>Plats</span>
                <select value={f.locationId} onChange={(e) => setFilters({ locationId: e.target.value })}>
                  <option value="all">Alla platser</option>
                  {locations.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.name || 'Namnlös plats'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="sk-field">
              <span>Pass</span>
              <select value={f.service} onChange={(e) => setFilters({ service: e.target.value as Filters['service'] })}>
                {SERVICES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sk-field">
              <span>Bokningskanal</span>
              <select value={f.channel} onChange={(e) => setFilters({ channel: e.target.value as Filters['channel'] })}>
                {CHANNELS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sk-field sk-wide">
              <span>Jämför med</span>
              <select value={f.compare} onChange={(e) => setFilters({ compare: e.target.value as Filters['compare'] })}>
                {COMPARES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn outline square sk-export"
              disabled={!ready || nothing}
              onClick={() => ready && download(csvFileName(ready, locationName), toCsv(ready))}
            >
              Exportera CSV
            </button>
          </div>
        </div>
        {/* Bara perioden syns; resten (antal dagar, jämförelse, plats, pass)
            fälls ut för den som vill läsa. */}
        <details className="sk-period">
          <summary>
            {f.from === f.to ? shortDate(f.from) : rangeLabel(f.from, f.to)}
            <span className="sk-period-more">Detaljer</span>
          </summary>
          <p>
            {days > 1 ? `${fmtInt(days)} dagar` : '1 dag'}
            {ready?.compare.from && ready.compare.to ? ` · jämförs med ${rangeLabel(ready.compare.from, ready.compare.to)}` : ''}
            {locationName ? ` · ${locationName}` : multi ? ' · alla platser' : ''}
            {f.service !== 'all' ? ` · ${f.service === 'lunch' ? 'lunch' : 'middag'}` : ''}
          </p>
        </details>

        {ready?.pending && (
          <p className="sk-note" role="status">
            Senaste 31 dagarna. Äldre dagar kommer i morgon.
          </p>
        )}
        {ready && !money && (
          <p className="sk-note" role="status">
            Belopp visas bara för ägaren.
          </p>
        )}

        {error && (
          <ErrorNote text={booqyFaultText('Kunde inte hämta siffrorna.')} />
        )}

        {!s && !error && (
          <SkelPage label="Räknar ihop perioden">
            <section className="sk-block" aria-hidden="true">
              <SkelBlock w={160} h={22} />
              <div className="sk-kpis">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <SkelBox key={i} className="admin-card sk-kpi">
                    <SkelBlock w="44%" h={12} />
                    <SkelBlock w="36%" h={36} style={{ borderRadius: 'var(--r-md)' }} />
                  </SkelBox>
                ))}
              </div>
            </section>
            <section className="sk-block" aria-hidden="true">
              <SkelBlock w={200} h={22} />
              <SkelCard chart aside={false} />
            </section>
          </SkelPage>
        )}

        {s && nothing && (
          <section className="admin-card table-card sk-empty-card">
            <h2 className="card-title">Inget i perioden</h2>
            {!showSample && (
              <button type="button" className="btn outline square" onClick={() => chooseSample(true)}>
                Visa med exempeldata
              </button>
            )}
          </section>
        )}

        {s && !nothing && (
          <>
            <section aria-labelledby="sk-deep" className="sk-block">
              <nav className="sk-anchors" aria-label="Avsnitt">
                {SECTIONS.filter((x) => (x.id === 'omsattning' ? money && showOrders : x.id === 'meny' ? showOrders : x.id === 'catering' ? showCatering : x.id === 'hemsidan' ? showWeb : true)).map((x) => (
                  <a key={x.id} href={`#${x.id}`} onClick={(e) => {
                    e.preventDefault()
                    revealSection(x.id)
                  }}>
                    {x.label}
                  </a>
                ))}
              </nav>

              <Disclosure id="nyckeltal" title="Så gick det" meta={todo.length ? `${todo.length} att göra` : undefined} className="sk-acc" defaultOpen={open.includes('nyckeltal')} onToggle={toggle('nyckeltal')}>
                <div className="sk-kpis">
                  {kpiTiles && kpiOrder.map((k) => kpiTiles[k])}
                </div>
                <h3 className="sk-sub-title">Att göra</h3>
                {todo.length === 0 ? (
                  <p className="admin-card sk-todo-none">Inget att göra.</p>
                ) : (
                  <ol className="sk-todo">
                    {todo.map((t, i) => (
                      <li key={t.id} className="admin-card sk-todo-item">
                        <span className="sk-todo-n" aria-hidden="true">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <h4 className="sk-todo-title">{t.title}</h4>
                          <p className="sk-todo-text">{t.text}</p>
                          <Link className="card-link" to={t.to}>
                            {t.linkLabel} →
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Disclosure>

              {/* Ägaren: pengarna över tid först, sedan gästerna (docs/DASHBOARD.md). */}
              {money && showOrders && (
                <>
                  <Disclosure id="omsattning" title="Omsättning" className="sk-acc" defaultOpen={open.includes('omsattning')} onToggle={toggle('omsattning')}>
                    <div className="sk-charts">
                    <Card title={insightTitle('Omsättningen', deltaPct(s.revenue, p?.revenue))} label="Omsättning per dag" info="Betalda beställningar på dagen de betalades, catering på leveransdagen, inklusive moms." wide>
                      <ColumnChart
                        unit="kr"
                        format={fmtKr}
                        seriesLabel="Omsättning"
                        previousLabel={p && prevByDay(0) ? (f.compare === 'year' ? 'Förra året' : 'Förra perioden') : undefined}
                        ariaLabel="Omsättning per dag"
                        points={s.byDay.map((d, i) => ({
                          key: d.date,
                          label: shortDate(d.date),
                          value: d.revenue ?? 0,
                          previous: prevByDay(i)?.revenue,
                          detail: `${fmtInt(d.orders)} beställningar`,
                          title: `${shortDate(d.date)}: ${fmtKr(d.revenue)} (${fmtInt(d.orders)} beställningar)${prevByDay(i) ? `, ${cmp} ${fmtKr(prevByDay(i)!.revenue)}` : ''}`,
                        }))}
                        tableHead={['Dag', 'Omsättning', 'Beställningar', 'Catering']}
                        tableRows={s.byDay.map((d) => [shortDate(d.date), fmtKr(d.revenue), d.orders, fmtKr(d.cateringRevenue)])}
                      />
                      <Tip>Jämför med samma period förra året för att se säsongen, inte bara förra veckan.</Tip>
                    </Card>
                  </div>
                  </Disclosure>
                </>
              )}

              <Disclosure id="gaster" title="Gäster och bokningar" className="sk-acc" defaultOpen={open.includes('gaster')} onToggle={toggle('gaster')}>
                <div className="sk-charts">
                <Card title="Gäster per dag" label="Gäster per dag" info="Personer i bokningar som inte avbokats, räknat på dagen de kommer. Uteblivna räknas med; tabellen visar hur många som uteblev och avbokade." wide>
                  <ColumnChart
                    unit="count"
                    format={fmtInt}
                    seriesLabel="Gäster"
                    previousLabel={p && prevByDay(0) ? (f.compare === 'year' ? 'Förra året' : 'Förra perioden') : undefined}
                    ariaLabel="Gäster per dag"
                    points={s.byDay.map((d, i) => ({
                      key: d.date,
                      label: shortDate(d.date),
                      value: d.guests,
                      previous: prevByDay(i)?.guests,
                      detail: `${fmtInt(d.bookings)} bokningar`,
                      title: `${shortDate(d.date)}: ${fmtInt(d.guests)} gäster i ${fmtInt(d.bookings)} bokningar${prevByDay(i) ? `, ${cmp} ${fmtInt(prevByDay(i)!.guests)}` : ''}`,
                    }))}
                    tableHead={['Dag', 'Gäster', 'Bokningar', 'Uteblivna', 'Avbokade']}
                    tableRows={s.byDay.map((d) => [shortDate(d.date), d.guests, d.bookings, d.noShows, d.cancelled])}
                  />
                  <Tip>
                    {peakDay && peakDay.guests > 0
                      ? `${WEEKDAY_LABELS[peakDay.weekday]} tar flest gäster i snitt. Lägg extra personal där, och prova ett erbjudande på den svagaste dagen.`
                      : 'Jämför veckorna: en dag som alltid är svag är ett bättre mål för ett erbjudande än hela veckan.'}
                  </Tip>
                </Card>

                <Card title={peakHour ? `Flest bokningar klockan ${hourLabel(peakHour.hour).slice(0, 2)}` : 'När gästerna kommer'} label="Bokningar per timme" info="Bokningar som inte avbokats, efter klockslaget de börjar.">
                  <BarChart
                    format={fmtInt}
                    seriesLabel="Bokningar"
                    ariaLabel="Bokningar per timme"
                    rows={s.byHour.filter((h) => h.bookings > 0).map((h) => ({
                      key: String(h.hour),
                      label: hourLabel(h.hour),
                      value: h.bookings,
                      detail: `${fmtInt(h.guests)} gäster`,
                      title: `${hourLabel(h.hour)}: ${fmtInt(h.bookings)} bokningar, ${fmtInt(h.guests)} gäster`,
                    }))}
                    tableHead={['Timme', 'Bokningar', 'Gäster']}
                    tableRows={s.byHour.map((h) => [hourLabel(h.hour), h.bookings, h.guests])}
                  />
                  <Tip>Bemanna efter topparna och ha köket redo en halvtimme före. Svaga timmar passar för en tidig sittning eller ett happy hour.</Tip>
                </Card>

                <Card title="Gäster per veckodag" label="Gäster per veckodag" info="Gäster i snitt per veckodag i perioden: alla gäster den veckodagen delat med hur många sådana dagar perioden har. Veckodagar som inte finns i perioden visas inte.">
                  <BarChart
                    format={(v) => fmtDecimal(v, v < 10 ? 1 : 0)}
                    seriesLabel="Gäster per dag"
                    ariaLabel="Gäster i snitt per veckodag"
                    rows={weekdays.map((d) => ({
                      key: String(d.weekday),
                      label: WEEKDAY_LABELS[d.weekday],
                      value: d.avgGuests,
                      detail: `${fmtInt(d.days)} ${d.days === 1 ? 'dag' : 'dagar'}`,
                      title: `${WEEKDAY_LABELS[d.weekday]}: ${fmtDecimal(d.avgGuests)} gäster per dag (${fmtInt(d.guests)} på ${fmtInt(d.days)} ${d.days === 1 ? 'dag' : 'dagar'})`,
                    }))}
                    tableHead={['Veckodag', 'Gäster per dag', 'Gäster', 'Dagar', 'Beläggning']}
                    tableRows={weekdays.map((d) => [WEEKDAY_LABELS[d.weekday], fmtDecimal(d.avgGuests), d.guests, d.days, d.occupancy === null ? 'Stängt' : fmtPct(d.occupancy)])}
                  />
                  <Tip>Planera inköp och schema per veckodag, inte per vecka.</Tip>
                </Card>

                <Card title="Hur gästerna bokar" label="Bokningskanal" info="Bokningar i perioden som inte avbokats, efter hur de kom in: Online = gästen bokade själv på hemsidan, Telefon = personalen bokade ett samtal, På plats = drop-in som personalen lade in.">
                  <Ring
                    title="Bokningar per kanal"
                    total={sourced}
                    centerLabel="online"
                    empty="Inga bokningar"
                    format={fmtInt}
                    segments={[
                      { key: 'online', label: 'Online', value: s.sources.online, tone: 'ink' },
                      { key: 'phone', label: 'Telefon', value: s.sources.phone, tone: 'red' },
                      { key: 'onsite', label: 'På plats', value: s.sources.onsite, tone: 'steel' },
                    ]}
                  />
                  <Tip>
                    {sourced > 0 && s.sources.phone / sourced >= 0.3
                      ? 'Många ringer. Lyft fram "Boka bord" på hemsidan, Google och Instagram, så frigörs telefonen under rusningen.'
                      : 'De flesta bokar själva. Håll öppettider och bordsregler aktuella, så slipper ni dubbelbokningar och samtal.'}
                  </Tip>
                </Card>

                <Card title="Hur bokningarna slutade" label="Utfall" info="Alla bokningar i perioden: Kom och Uteblev är det personalen har markerat, Ej markerade är kommande eller aldrig markerade, Avbokade är avbokade av gästen eller restaurangen.">
                  <Ring
                    title="Utfall"
                    total={s.bookings + s.cancelled}
                    centerLabel="kom"
                    empty="Inga bokningar"
                    format={fmtInt}
                    segments={[
                      { key: 'came', label: 'Kom', value: s.arrived, tone: 'ink' },
                      { key: 'noshow', label: 'Uteblev', value: s.noShows, tone: 'red' },
                      { key: 'unmarked', label: 'Ej markerade', value: unmarked, tone: 'muted' },
                      { key: 'cancelled', label: 'Avbokade', value: s.cancelled, tone: 'steel' },
                    ]}
                  />
                  <Tip>
                    {s.noShowPct !== null && s.noShowPct >= 5
                      ? 'Över 5 % uteblir. Kräv kort vid bokning för större sällskap och skicka påminnelse dagen före.'
                      : `Under 5 % uteblir${s.cardOnFilePct !== null ? `, ${fmtPct(s.cardOnFilePct)} har kort sparat` : ''}. Behåll påminnelserna.`}
                  </Tip>
                </Card>

                <Card title={leadSoon !== null ? `${fmtPct(leadSoon)} bokar samma dag eller dagen före` : 'Hur långt i förväg'} label="Framförhållning" info="Hur många dagar före besöket bokningen gjordes, för online- och telefonbokningar som inte avbokats. Drop-in räknas inte: de bokade aldrig i förväg.">
                  <BarChart
                    format={fmtInt}
                    seriesLabel="Bokningar"
                    ariaLabel="Bokningar efter hur långt i förväg de gjordes"
                    rows={s.lead.map((l) => ({
                      key: l.label,
                      label: LEAD_LABELS[l.label] ?? l.label,
                      value: l.bookings,
                      title: `${LEAD_LABELS[l.label] ?? l.label}: ${fmtInt(l.bookings)} bokningar`,
                    }))}
                    tableHead={['Bokat', 'Bokningar']}
                    tableRows={s.lead.map((l) => [LEAD_LABELS[l.label] ?? l.label, l.bookings])}
                  />
                  <Tip>Skicka erbjudanden så långt i förväg som gästerna faktiskt bokar: sent bokande gäster nås dagen före, inte veckan innan.</Tip>
                </Card>

                <Card title={s.avgParty ? `${fmtDecimal(s.avgParty)} gäster per sällskap` : 'Sällskapens storlek'} label="Sällskapens storlek" info="Hur många bokningar som gällde 1, 2, 3 och så vidare personer, avbokade räknas inte.">
                  <BarChart
                    format={fmtInt}
                    seriesLabel="Bokningar"
                    ariaLabel="Bokningar per sällskapsstorlek"
                    rows={s.party.map((x) => ({
                      key: String(x.size),
                      label: x.size >= 8 ? '8+' : String(x.size),
                      heading: `${x.size >= 8 ? '8 eller fler' : x.size} gäster`,
                      value: x.bookings,
                      title: `${x.size >= 8 ? '8 eller fler' : x.size} gäster: ${fmtInt(x.bookings)} bokningar`,
                    }))}
                    tableHead={['Gäster', 'Bokningar']}
                    tableRows={s.party.map((x) => [x.size >= 8 ? '8+' : x.size, x.bookings])}
                  />
                  <Tip>Mest par? Fler 2-bord, eller bord som går att dela, fyller salen bättre än stora bord.</Tip>
                </Card>
              </div>
              </Disclosure>

              <Disclosure id="belaggning" title="Beläggning" className="sk-acc" defaultOpen={open.includes('belaggning')} onToggle={toggle('belaggning')}>
                <div className="sk-charts">
                <Card title="Beläggning per veckodag och timme" label="Beläggning per veckodag och timme" info="För varje veckodag och timme: hur stor del av alla bords tid som var bokad, för alla sådana dagar i perioden. Bara öppna timmar visas. 50 betyder att hälften av bordstiden var bokad." wide>
                  <Heatmap
                    rows={heatDays.map((wd) => WEEKDAY_LABELS[wd])}
                    cols={heatHours.map((h) => hourLabel(h).slice(0, 2))}
                    cells={s.heat.map((c) => ({
                      row: heatDays.indexOf(c.weekday),
                      col: heatHours.indexOf(c.hour),
                      value: c.occupancy,
                      title: `${WEEKDAY_LABELS[c.weekday]} ${hourLabel(c.hour)}: ${fmtPct(c.occupancy)} bokat`,
                    }))}
                    ariaLabel="Beläggning per veckodag och timme"
                    tableHead={['Dag', ...heatHours.map((h) => hourLabel(h))]}
                    tableRows={heatDays.map((wd) => [
                      WEEKDAY_LABELS[wd],
                      ...heatHours.map((h) => {
                        const c = s.heat.find((x) => x.weekday === wd && x.hour === h)
                        return c ? fmtPct(c.occupancy) : 'Stängt'
                      }),
                    ])}
                  />
                  <Tip>Ljusa rutor är tomma bord: rikta erbjudanden och evenemang dit. Mörka rutor som alltid är fulla tål en kortare bordstid eller en extra sittning.</Tip>
                </Card>

                <Card title={lowSize ? `${SIZE_LABELS[lowSize.size] ?? lowSize.size} används minst` : 'Beläggning per bordsstorlek'} label="Beläggning per bordsstorlek" info="Bord grupperade efter antal stolar (2-bord = 1-2 stolar, 4-bord = 3-4, 6-bord = 5-6). Visar hur stor del av öppettiden bord av varje storlek var bokade i hela perioden, inte bara idag.">
                  <BarChart
                    format={(v) => fmtPct(v)}
                    seriesLabel="Beläggning"
                    ariaLabel="Beläggning per bordsstorlek"
                    rows={sizeRows.map((r) => ({
                      key: r.size,
                      label: SIZE_LABELS[r.size] ?? r.size,
                      value: r.occupancy ?? 0,
                      title: `${SIZE_LABELS[r.size] ?? r.size}: ${fmtPct(r.occupancy)} bokat`,
                    }))}
                    tableHead={['Bord', 'Beläggning']}
                    tableRows={sizeRows.map((r) => [SIZE_LABELS[r.size] ?? r.size, fmtPct(r.occupancy)])}
                  />
                  <Tip>Står stora bord tomma medan små är fulla? Gör om ett 6-bord till ett 2- och ett 4-bord i Layout.</Tip>
                </Card>

                <Card title={lowDay && openWeekdays.length > 1 ? `${WEEKDAY_LABELS[lowDay.weekday]} har lägst beläggning` : 'Beläggning per veckodag'} label="Beläggning per veckodag" info="Bokad bordstid delat med all bordstid under öppettiderna, per veckodag i perioden. Veckodagar som inte finns i perioden eller har stängt visas inte.">
                  <BarChart
                    format={(v) => fmtPct(v)}
                    seriesLabel="Beläggning"
                    ariaLabel="Beläggning per veckodag"
                    rows={openWeekdays.map((d) => ({
                      key: String(d.weekday),
                      label: WEEKDAY_LABELS[d.weekday],
                      value: d.occupancy ?? 0,
                      title: `${WEEKDAY_LABELS[d.weekday]}: ${fmtPct(d.occupancy)} bokat (${fmtInt(d.days)} ${d.days === 1 ? 'dag' : 'dagar'})`,
                    }))}
                    tableHead={['Veckodag', 'Beläggning', 'Dagar']}
                    tableRows={weekdays.map((d) => [WEEKDAY_LABELS[d.weekday], d.occupancy === null ? 'Stängt' : fmtPct(d.occupancy), d.days])}
                  />
                  <Tip>Under 40 % en dag i veckan? Fundera på kortare öppettider den dagen, eller ett fast erbjudande.</Tip>
                </Card>
              </div>
              </Disclosure>

              {showOrders && (
                <>
                  <Disclosure id="meny" title="Beställningar och meny" className="sk-acc" defaultOpen={open.includes('meny')} onToggle={toggle('meny')}>
                    <div className="sk-charts">
                    <Card title={money ? `${fmtKr(s.avgOrder)} per beställning` : `${fmtInt(s.orders)} beställningar`} label="Beställningarna" info="Betalda onlinebeställningar i perioden, räknat på dagen de betalades.">
                      {money && (
                        <Ring
                          title="Var pengarna kommer ifrån"
                          total={s.revenue ?? 0}
                          centerLabel="avhämtning"
                          empty="Inget betalt än"
                          format={fmtKr}
                          valueLabel="Belopp"
                          segments={[
                            { key: 'pickup', label: 'Avhämtning', value: s.pickupRevenue ?? 0, tone: 'ink' },
                            { key: 'table', label: 'Vid bordet', value: s.tableRevenue ?? 0, tone: 'red' },
                            { key: 'catering', label: 'Catering', value: s.cateringRevenue ?? 0, tone: 'steel' },
                          ]}
                        />
                      )}
                      <dl className="sk-facts">
                        <dt>Betalda beställningar</dt>
                        <dd>{fmtInt(s.orders)}</dd>
                        <dt>Vid bordet</dt>
                        <dd>{fmtInt(s.tableOrders)}</dd>
                        <dt>Tillagningstid</dt>
                        <dd>{s.prepMinutes !== null ? `${fmtDecimal(s.prepMinutes)} min` : '-'}</dd>
                        <dt>Klara sent</dt>
                        <dd>{fmtPct(s.latePct)}</dd>
                        {money && (
                          <>
                            <dt>Avgifter, uteblivna och sena</dt>
                            <dd>
                              {fmtKr(s.feesCharged)}
                              {s.feesFailed > 0 ? `, ${fmtInt(s.feesFailed)} misslyckade` : ''}
                            </dd>
                          </>
                        )}
                      </dl>
                      <Tip>
                        {money
                          ? 'Höj snittordern med tillbehör i beställningen: dryck, dessert eller en extra sås.'
                          : 'Blir många beställningar klara sent? Säg till ägaren, så kan tidsestimatet höjas vid rusning.'}
                      </Tip>
                    </Card>

                    <Card title="Mest sålda" label="Mest sålda rätter" info="Rätter i betalda beställningar i perioden, efter antal sålda.">
                      {topDishes.length === 0 ? (
                        <p className="sk-empty">Inga beställningar i perioden.</p>
                      ) : (
                        <div className="sk-scroll">
                          <table className="sk-dishes">
                            <thead>
                              <tr>
                                <th scope="col" className="sk-rank">
                                  #
                                </th>
                                <th scope="col">Rätt</th>
                                <th scope="col" className="num">
                                  Antal
                                </th>
                                {money && (
                                  <th scope="col" className="num">
                                    Omsättning
                                  </th>
                                )}
                                {p && (
                                  <th scope="col" className="num">
                                    Ändring
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {topDishes.map((d, i) => (
                                <tr key={d.id}>
                                  <td className="sk-rank">{i + 1}</td>
                                  <td>{d.name}</td>
                                  <td className="num">{fmtInt(d.quantity)}</td>
                                  {money && <td className="num">{fmtKr(d.revenue)}</td>}
                                  {p && (
                                    <td className="num">
                                      <TrendBadge trend={trendOf(d.quantity, d.previousQuantity ?? 0, 'dishQuantity', cmp)} />
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <Tip>Lyft fram de bästsäljande rätterna överst i menyn och på bilderna.</Tip>
                    </Card>

                    {bottomDishes.length > 0 && (
                      <Card title="Säljer minst" label="Minst sålda rätter" info="De rätter som sålt minst i perioden bland dem som sålts minst en gång.">
                        <div className="sk-scroll">
                          <table className="sk-dishes">
                            <thead>
                              <tr>
                                <th scope="col">Rätt</th>
                                <th scope="col" className="num">
                                  Antal
                                </th>
                                {money && (
                                  <th scope="col" className="num">
                                    Omsättning
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {bottomDishes.map((d) => (
                                <tr key={d.id}>
                                  <td>{d.name}</td>
                                  <td className="num">{fmtInt(d.quantity)}</td>
                                  {money && <td className="num">{fmtKr(d.revenue)}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <Tip>En rätt som säljer dåligt i 30 dagar: byt plats i menyn, ändra pris eller ta bort den.</Tip>
                      </Card>
                    )}

                    {ready && (
                      <Slot
                        id="statistik.dishes.margin"
                        props={{ insights: ready, locationId: f.locationId, from: f.from, to: f.to }}
                      />
                    )}

                    {s.pairs.length > 0 && (
                      <Card title="Beställs ofta tillsammans" label="Beställs ofta tillsammans" info="Par av rätter som funnits i samma betalda beställning, och hur många beställningar det gällde.">
                        <ul className="sk-pairs">
                          {s.pairs.slice(0, 6).map((x) => (
                            <li key={`${x.a}|${x.b}`}>
                              <span>
                                {x.a} <span className="sk-pair-plus">+</span> {x.b}
                              </span>
                              <span className="sk-pair-n">{fmtInt(x.orders)} beställningar</span>
                            </li>
                          ))}
                        </ul>
                        <Tip>Gör ett paketpris av paren som redan säljer ihop, eller föreslå den andra rätten när gästen beställer.</Tip>
                      </Card>
                    )}
                  </div>
                  </Disclosure>
                </>
              )}

              {ready && (
                <Slot id="statistik.events" props={{ insights: ready, locationId: f.locationId, from: f.from, to: f.to }} />
              )}

              {showCatering && (
                <>
                  <Disclosure id="catering" title="Catering" className="sk-acc" defaultOpen={open.includes('catering')} onToggle={toggle('catering')}>
                    <div className="sk-charts">
                    <Card title={s.catering.conversionPct !== null ? `${fmtPct(s.catering.conversionPct)} av offerterna blev beställningar` : 'Från förfrågan till beställning'} label="Catering" info="Förfrågningar räknas dagen de kom in, offerter dagen de skickades, accepterade dagen de signerades och värdet på leveransdagen.">
                      <BarChart
                        format={fmtInt}
                        seriesLabel="Antal"
                        ariaLabel="Catering från förfrågan till beställning"
                        rows={[
                          { key: 'req', label: 'Förfr.', heading: 'Förfrågningar', value: s.catering.requests, title: `${fmtInt(s.catering.requests)} förfrågningar` },
                          { key: 'off', label: 'Offert', heading: 'Offerter skickade', value: s.catering.offers, title: `${fmtInt(s.catering.offers)} offerter skickade` },
                          { key: 'won', label: 'Ja', heading: 'Accepterade', value: s.catering.won, title: `${fmtInt(s.catering.won)} accepterade` },
                        ]}
                        tableHead={['Steg', 'Antal']}
                        tableRows={[
                          ['Förfrågningar', s.catering.requests],
                          ['Offerter skickade', s.catering.offers],
                          ['Accepterade', s.catering.won],
                        ]}
                      />
                      <dl className="sk-facts">
                        <dt>Tid till offert</dt>
                        <dd>{s.catering.replyHours !== null ? `${fmtDecimal(s.catering.replyHours)} timmar` : '-'}</dd>
                        <dt>Levererade</dt>
                        <dd>{fmtInt(s.catering.delivered)}</dd>
                        {money && (
                          <>
                            <dt>Värde levererat</dt>
                            <dd>{fmtKr(s.catering.cateringRevenue)}</dd>
                            <dt>Snitt per leverans</dt>
                            <dd>{fmtKr(s.catering.avgCatering)}</dd>
                          </>
                        )}
                      </dl>
                      <Tip>Svara inom ett dygn: snabba offerter vinner oftare. Följ upp offerter som inte fått svar efter tre dagar.</Tip>
                      <Link className="card-link" to="/catering">
                        Till förfrågningarna →
                      </Link>
                    </Card>
                  </div>
                  </Disclosure>
                </>
              )}

              {showWeb && (
                <>
                  <Disclosure id="hemsidan" title="Hemsidan" className="sk-acc" defaultOpen={open.includes('hemsidan')} onToggle={toggle('hemsidan')}>
                    <div className="sk-charts">
                    <Card title={s.web.conversionPct !== null ? `${fmtPct(s.web.conversionPct)} av besöken blev en bokning eller beställning` : 'Besök på hemsidan'} label="Hemsidan" info="Besök på restaurangens hemsida (räknas utan cookies) och bokningar och beställningar som gjordes direkt efter ett besök, räknat på dagen de gjordes. Bokningar längre upp räknas på besöksdagen, så siffrorna kan skilja." wide>
                      <dl className="sk-facts sk-facts--row">
                        <dt>Besök</dt>
                        <dd>{fmtInt(s.web.visits)}</dd>
                        <dt>Bokningar</dt>
                        <dd>{fmtInt(s.web.bookings)}</dd>
                        <dt>Beställningar</dt>
                        <dd>{fmtInt(s.web.orders)}</dd>
                      </dl>
                      {s.web.channels.length > 0 && (
                        <div className="sk-scroll">
                          <table className="sk-dishes">
                            <thead>
                              <tr>
                                <th scope="col">Kanal</th>
                                <th scope="col" className="num">
                                  Besök
                                </th>
                                <th scope="col" className="num">
                                  Bokningar
                                </th>
                                <th scope="col" className="num">
                                  Beställningar
                                </th>
                                <th scope="col" className="num">
                                  Konvertering
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.web.channels.map((c) => (
                                <tr key={c.channel}>
                                  <td>{channelLabel(c.channel)}</td>
                                  <td className="num">{fmtInt(c.visits)}</td>
                                  <td className="num">{fmtInt(c.bookings)}</td>
                                  <td className="num">{fmtInt(c.orders)}</td>
                                  <td className="num">{fmtPct(c.conversionPct)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <Tip>En kanal med många besök men få bokningar: se till att länken går direkt till bokningen. Mät nya kampanjer med en egen länk under Marknadsföring.</Tip>
                    </Card>
                  </div>
                  </Disclosure>
                </>
              )}
            </section>

          </>
        )}
      </div>
    </>
  )
}
