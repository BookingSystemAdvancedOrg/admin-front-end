import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { isApiConfigured } from '../../shared/api'
import { Loading } from '../../shared/Loading'
import { Num } from '../../shared/motion/Num'
import { TrendBadge } from '../../shared/TrendBadge'
import { useTrendPop } from '../../shared/motion/useTrendPop'
import { toneClass, trendOf } from '../../shared/trend'
import type { Trend, TrendMetric } from '../../shared/trend'
import { canSeeInsights, currentLocation, useTenant } from '../../shared/tenant'
import { todayIn } from '../bokningar/bookingsApi'
import { channelLabel } from '../marknadsforing/marketingApi'
import { sampleModeOn, setSampleMode } from '../oversikt/sample'
import { BarChart, ColumnChart, Delta, Heatmap, Ring, Sparkline } from './charts'
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
  presetRange,
  signals,
  toCsv,
} from './insights'
import type { Filters, InsightsResponse, InsightsSummary, PresetId } from './insights'
import { fetchInsights, insightsQuery } from './insightsApi'
import { sampleInsights } from './insightsSample'
import { addDays, daysBetween, deltaPct, fmtDecimal, fmtInt, fmtKr, fmtPct, insightTitle, rangeLabel, shortDate } from './stats'
import './statistik.css'
import { DateInput } from '../../shared/DateInput'

/**
 * Statistik: restaurangens egna siffror för en period, i tre steg: vad som
 * hände (nyckeltalen), vad man kan göra (Att göra) och varför (gäster,
 * beläggning, meny, catering, hemsidan). Varje diagram har en rad "Gör så
 * här" och en tabell bakom.
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

function Tile({
  label,
  value,
  sub,
  trend,
  against,
  spark,
  tone,
}: {
  label: string
  value: string
  sub?: string
  /** Mot jämförelsen (shared/trend); null = ingen förra period, utelämnad = ingen jämförelse vald. */
  trend?: Trend | null
  against?: string
  spark?: { points: { label: string; value: number }[]; format: (v: number) => string }
  tone?: 'warn' | 'bad'
}) {
  // En egen varningsfärg (t.ex. många uteblivna) går före tonen mot förra perioden.
  const trendTone = !tone && trend ? trend.tone : 'neutral'
  const valueRef = useTrendPop<HTMLElement>(trendTone, 500)
  return (
    <div className={`admin-card sk-kpi${tone ? ` sk-kpi--${tone}` : ''}`}>
      <span className="sk-kpi-label">{label}</span>
      <strong ref={valueRef} className={`sk-kpi-value${toneClass(trendTone)}`}>
        <Num>{value}</Num>
      </strong>
      {spark && <Sparkline points={spark.points} format={spark.format} label={label} />}
      {sub && <span className="sk-kpi-sub">{sub}</span>}
      {trend !== undefined && <Delta trend={trend}>mot {against}</Delta>}
    </div>
  )
}

/** "Gör så här": vad siffran betyder för den som driver restaurangen. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="sk-tip">
      <span className="sk-tip-label">Gör så här</span> {children}
    </p>
  )
}

function Card({ title, label, children, wide }: { title: string; label: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`admin-card${wide ? ' sk-wide' : ''}`} aria-label={label}>
      <h3 className="card-title">{title}</h3>
      {children}
    </section>
  )
}

const SECTIONS = [
  { id: 'gaster', label: 'Gäster' },
  { id: 'belaggning', label: 'Beläggning' },
  { id: 'meny', label: 'Beställningar och meny' },
  { id: 'catering', label: 'Catering' },
  { id: 'hemsidan', label: 'Hemsidan' },
]

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

  useEffect(() => {
    if (!allowed || !target || showSample) return
    let cancelled = false
    fetchInsights({ from, to, locationId: target, service, channel, compare })
      .then((data) => !cancelled && setLoaded({ key, data }))
      .catch(() => !cancelled && setErrorKey(key))
    return () => {
      cancelled = true
    }
  }, [key, allowed, showSample, target, from, to, service, channel, compare])

  if (!allowed) {
    return (
      <>
        <AdminTopbar title="Statistik" />
        <div className="admin-main">
          <section className="admin-card table-card tenant-notice">
            <h2 className="card-title">Inte öppen för personalen</h2>
            <p className="cell-muted">Restaurangens ägare har valt att bara ägaren ser statistiken.</p>
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
            <p className="cell-muted">Lägg in restaurangens uppgifter under Inställningar, så finns det något att räkna på.</p>
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
  const spark = (pick: (d: InsightsSummary['byDay'][number]) => number | null | undefined, format: (v: number) => string = fmtInt) =>
    s && s.byDay.length >= 7 ? { points: s.byDay.map((d) => ({ label: shortDate(d.date), value: pick(d) ?? 0 })), format } : undefined
  const split = Number((ready?.locations.find((l) => l.locationId === f.locationId) ?? ready?.locations[0])?.lunchUntil?.slice(0, 2) ?? 15)
  const todo = s ? signals(s, p, { split, marketing: Boolean(features.marketing) }) : []
  const nothing = s !== null && s.bookings + s.cancelled + s.orders + s.catering.requests === 0
  const locationName = f.locationId === 'all' ? null : (locations.find((l) => l.locationId === f.locationId)?.name ?? location?.name ?? null)
  const filterCount = activeFilterCount(f, defaultLocation)
  const showOrders = Boolean(features.ordering) || (s?.orders ?? 0) > 0
  const showCatering = Boolean(features.catering) || (s?.catering.requests ?? 0) > 0
  const showWeb = Boolean(features.marketing) || (s?.web.visits ?? 0) > 0
  const heatHours = s ? [...new Set(s.heat.map((c) => c.hour))].sort((a, b) => a - b) : []
  const peakHour = s?.byHour.reduce<InsightsSummary['byHour'][number] | null>((best, h) => (!best || h.bookings > best.bookings ? h : best), null)
  const peakDay = s?.byWeekday.reduce((best, d) => (d.guests > best.guests ? d : best), s.byWeekday[0])
  const leadSoon = s && s.bookings > 0 ? (((s.lead[0]?.bookings ?? 0) + (s.lead[1]?.bookings ?? 0)) / s.bookings) * 100 : null
  const sourced = s ? s.sources.online + s.sources.phone + s.sources.onsite : 0
  const prevByDay = (i: number) => (p && p.byDay.length === s?.byDay.length ? p.byDay[i] : undefined)
  const sizeRows = s?.bySize ?? []
  const lowSize = sizeRows.reduce<(typeof sizeRows)[number] | null>((low, r) => (r.occupancy !== null && (!low || (low.occupancy ?? 101) > r.occupancy) ? r : low), null)
  const topDishes = s?.dishes.slice(0, 10) ?? []
  const bottomDishes = s && s.dishes.length > 12 ? [...s.dishes].slice(-5).reverse() : []

  return (
    <>
      <AdminTopbar title="Statistik" />
      <div className="admin-main sk-page">
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
            <label className="sk-field">
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
        <p className="sk-period">
          {f.from === f.to ? shortDate(f.from) : rangeLabel(f.from, f.to)}
          {days > 1 ? `, ${fmtInt(days)} dagar` : ''}
          {ready?.compare.from && ready.compare.to ? ` · jämförs med ${rangeLabel(ready.compare.from, ready.compare.to)}` : ''}
          {locationName ? ` · ${locationName}` : multi ? ' · alla platser' : ''}
          {f.service !== 'all' ? ` · ${f.service === 'lunch' ? 'lunch' : 'middag'}` : ''}
        </p>

        {showSample && (
          <div className="sample-notice" role="status">
            <span className="sample-stamp">Exempel</span>
            <span>Du ser exempeldata, inte restaurangens riktiga siffror.</span>
            {sample && !offline && (
              <button type="button" className="link-action" onClick={() => chooseSample(false)}>
                Visa riktiga siffror
              </button>
            )}
          </div>
        )}
        {ready?.pending && (
          <p className="sk-note" role="status">
            Statistiken byggs upp i natt. Tills dess visas de senaste 31 dagarna; äldre dagar och jämförelser fylls på i morgon.
          </p>
        )}
        {ready && !money && (
          <p className="sk-note" role="status">
            Du ser driftsiffrorna för {locationName ?? 'din plats'}. Belopp visas bara för restaurangens ägare.
          </p>
        )}

        {error && (
          <div className="form-error" role="alert">
            Kunde inte hämta siffrorna. Försök igen om en stund.
          </div>
        )}

        {!s && !error && (
          <div className="admin-card table-card">
            <Loading variant="block" label="Räknar ihop perioden" />
          </div>
        )}

        {s && nothing && (
          <section className="admin-card table-card sk-empty-card">
            <h2 className="card-title">Inget att räkna på i perioden</h2>
            <p className="cell-muted">
              Inga bokningar, beställningar eller cateringförfrågningar {f.service !== 'all' ? 'för det passet ' : ''}än. Välj en längre
              period, eller se hur sidan ser ut när den används.
            </p>
            {!showSample && (
              <button type="button" className="btn outline square" onClick={() => chooseSample(true)}>
                Visa med exempeldata
              </button>
            )}
          </section>
        )}

        {s && !nothing && (
          <>
            <section aria-labelledby="sk-what" className="sk-block">
              <h2 className="sk-block-title" id="sk-what">
                Så gick det
              </h2>
              <div className="sk-kpis">
                <Tile
                  label="Gäster"
                  value={fmtInt(s.guests)}
                  sub={s.avgParty ? `${fmtDecimal(s.avgParty)} per sällskap` : 'Inga bokningar'}
                  spark={spark((d) => d.guests)}
                  {...versus(s.guests, p?.guests, 'guests')}
                />
                <Tile
                  label="Bokningar"
                  value={fmtInt(s.bookings)}
                  sub={`${fmtInt(s.cancelled)} avbokade, ${fmtInt(s.lateCancels)} sent`}
                  spark={spark((d) => d.bookings)}
                  {...versus(s.bookings, p?.bookings, 'bookings')}
                />
                <Tile
                  label="Beläggning"
                  value={fmtPct(s.occupancy)}
                  sub={s.seatFill !== null ? `${fmtPct(s.seatFill)} av stolarna fyllda` : 'av bordstiden bokad'}
                  spark={spark((d) => d.occupancy, (v) => fmtPct(v))}
                  {...versus(s.occupancy, p?.occupancy, 'occupancy')}
                />
                <Tile
                  label="Uteblivna"
                  value={fmtPct(s.noShowPct ?? 0)}
                  sub={
                    money && s.feeCount > 0
                      ? `${fmtInt(s.noShows)} bokningar, ${fmtKr(s.feesCharged)} i avgifter`
                      : `${fmtInt(s.noShows)} av ${fmtInt(s.bookings)} bokningar`
                  }
                  tone={s.noShowPct !== null && s.noShowPct >= 10 ? 'bad' : s.noShowPct !== null && s.noShowPct >= 5 ? 'warn' : undefined}
                  {...versus(s.noShowPct, p?.noShowPct, 'noShows')}
                />
                {money ? (
                  <>
                    <Tile
                      label="Omsättning"
                      value={fmtKr(s.revenue)}
                      sub={`Beställningar ${fmtKr(s.orderRevenue)}, catering ${fmtKr(s.cateringRevenue)}${s.inPersonRevenue ? `, kort i kassan ${fmtKr(s.inPersonRevenue)}` : ''}`}
                      spark={spark((d) => d.revenue, (v) => fmtKr(v))}
                      {...versus(s.revenue, p?.revenue, 'revenue')}
                    />
                    <Tile
                      label="Snittorder"
                      value={fmtKr(s.avgOrder)}
                      sub={`${fmtInt(s.orders)} betalda beställningar`}
                      {...versus(s.avgOrder, p?.avgOrder, 'avgOrder')}
                    />
                  </>
                ) : (
                  <>
                    <Tile label="Beställningar" value={fmtInt(s.orders)} sub={`${fmtInt(s.tableOrders)} vid bordet`} spark={spark((d) => d.orders)} {...versus(s.orders, p?.orders, 'orders')} />
                    <Tile
                      label="Tillagningstid"
                      value={s.prepMinutes !== null ? `${fmtDecimal(s.prepMinutes)} min` : '-'}
                      sub={s.latePct !== null ? `${fmtPct(s.latePct)} blev klara sent` : 'Från påbörjad till klar'}
                      {...versus(s.prepMinutes, p?.prepMinutes, 'prepTime')}
                    />
                  </>
                )}
              </div>
            </section>

            <section aria-labelledby="sk-todo" className="sk-block">
              <h2 className="sk-block-title" id="sk-todo">
                Att göra
              </h2>
              {todo.length === 0 ? (
                <p className="admin-card sk-todo-none">Inget sticker ut i perioden. Titta igen när fler gäster har bokat, eller välj en längre period.</p>
              ) : (
                <ol className="sk-todo">
                  {todo.map((t, i) => (
                    <li key={t.id} className="admin-card sk-todo-item">
                      <span className="sk-todo-n" aria-hidden="true">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <h3 className="sk-todo-title">{t.title}</h3>
                        <p className="sk-todo-text">{t.text}</p>
                        <Link className="card-link" to={t.to}>
                          {t.linkLabel} →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="sk-why" className="sk-block">
              <div className="sk-block-head">
                <h2 className="sk-block-title" id="sk-why">
                  Varför
                </h2>
                <nav className="sk-anchors" aria-label="Avsnitt">
                  {SECTIONS.filter((x) => (x.id === 'meny' ? showOrders : x.id === 'catering' ? showCatering : x.id === 'hemsidan' ? showWeb : true)).map((x) => (
                    <a key={x.id} href={`#${x.id}`} onClick={(e) => {
                      e.preventDefault()
                      document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}>
                      {x.label}
                    </a>
                  ))}
                </nav>
              </div>

              <h3 className="sk-section-title" id="gaster">
                Gäster och bokningar
              </h3>
              <div className="sk-charts">
                <Card title="Gäster per dag" label="Gäster per dag" wide>
                  <p className="sk-insight">
                    Gäster som bokat, per dag{p && prevByDay(0) ? `; linjen är ${cmp}` : ''}.
                  </p>
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
                      ? `${WEEKDAY_LABELS[peakDay.weekday]} tar flest gäster. Lägg extra personal där, och prova ett erbjudande på den svagaste dagen.`
                      : 'Jämför veckorna: en dag som alltid är svag är ett bättre mål för ett erbjudande än hela veckan.'}
                  </Tip>
                </Card>

                <Card title={peakHour ? `Flest bokningar klockan ${hourLabel(peakHour.hour).slice(0, 2)}` : 'När gästerna kommer'} label="Bokningar per timme">
                  <p className="sk-insight">Bokningar per starttimme.</p>
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

                <Card title="Gäster per veckodag" label="Gäster per veckodag">
                  <p className="sk-insight">Den tyngsta dagen i rött.</p>
                  <BarChart
                    format={fmtInt}
                    seriesLabel="Gäster"
                    ariaLabel="Gäster per veckodag"
                    rows={s.byWeekday.map((d) => ({
                      key: String(d.weekday),
                      label: WEEKDAY_LABELS[d.weekday],
                      value: d.guests,
                      detail: `${fmtInt(d.bookings)} bokningar`,
                      title: `${WEEKDAY_LABELS[d.weekday]}: ${fmtInt(d.guests)} gäster i ${fmtInt(d.bookings)} bokningar`,
                    }))}
                    tableHead={['Veckodag', 'Gäster', 'Bokningar', 'Beläggning']}
                    tableRows={s.byWeekday.map((d) => [WEEKDAY_LABELS[d.weekday], d.guests, d.bookings, fmtPct(d.occupancy)])}
                  />
                  <Tip>Planera inköp och schema per veckodag, inte per vecka.</Tip>
                </Card>

                <Card title="Hur gästerna bokar" label="Bokningskanal">
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

                <Card title="Hur bokningarna slutade" label="Utfall">
                  <Ring
                    title="Utfall"
                    total={s.bookings + s.cancelled}
                    centerLabel="kom"
                    empty="Inga bokningar"
                    format={fmtInt}
                    segments={[
                      { key: 'came', label: 'Kom', value: s.bookings - s.noShows, tone: 'ink' },
                      { key: 'noshow', label: 'Uteblev', value: s.noShows, tone: 'red' },
                      { key: 'cancelled', label: 'Avbokade', value: s.cancelled, tone: 'steel' },
                    ]}
                  />
                  <Tip>
                    {s.noShowPct !== null && s.noShowPct >= 5
                      ? 'Över 5 % uteblir. Kräv kort vid bokning för större sällskap och skicka påminnelse dagen före.'
                      : `Under 5 % uteblir${s.cardOnFilePct !== null ? `, ${fmtPct(s.cardOnFilePct)} har kort sparat` : ''}. Behåll påminnelserna.`}
                  </Tip>
                </Card>

                <Card title={leadSoon !== null ? `${fmtPct(leadSoon)} bokar samma dag eller dagen före` : 'Hur långt i förväg'} label="Framförhållning">
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

                <Card title={s.avgParty ? `${fmtDecimal(s.avgParty)} gäster per sällskap` : 'Sällskapens storlek'} label="Sällskapens storlek">
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

              <h3 className="sk-section-title" id="belaggning">
                Beläggning
              </h3>
              <div className="sk-charts">
                <Card title="Beläggning per veckodag och timme" label="Beläggning per veckodag och timme" wide>
                  <p className="sk-insight">Andel av bordstiden som var bokad, i procent. Mörkare = fullare.</p>
                  <Heatmap
                    rows={WEEKDAY_LABELS}
                    cols={heatHours.map((h) => hourLabel(h).slice(0, 2))}
                    cells={s.heat.map((c) => ({
                      row: c.weekday,
                      col: heatHours.indexOf(c.hour),
                      value: c.occupancy,
                      title: `${WEEKDAY_LABELS[c.weekday]} ${hourLabel(c.hour)}: ${fmtPct(c.occupancy)} bokat`,
                    }))}
                    ariaLabel="Beläggning per veckodag och timme"
                    tableHead={['Veckodag', 'Timme', 'Beläggning']}
                    tableRows={s.heat.map((c) => [WEEKDAY_LABELS[c.weekday], hourLabel(c.hour), fmtPct(c.occupancy)])}
                  />
                  <Tip>Ljusa rutor är tomma bord: rikta erbjudanden och evenemang dit. Mörka rutor som alltid är fulla tål en kortare bordstid eller en extra sittning.</Tip>
                </Card>

                <Card title={lowSize ? `${SIZE_LABELS[lowSize.size] ?? lowSize.size} används minst` : 'Beläggning per bordsstorlek'} label="Beläggning per bordsstorlek">
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

                <Card title="Beläggning per veckodag" label="Beläggning per veckodag">
                  <BarChart
                    format={(v) => fmtPct(v)}
                    seriesLabel="Beläggning"
                    ariaLabel="Beläggning per veckodag"
                    rows={s.byWeekday.map((d) => ({
                      key: String(d.weekday),
                      label: WEEKDAY_LABELS[d.weekday],
                      value: d.occupancy ?? 0,
                      title: `${WEEKDAY_LABELS[d.weekday]}: ${fmtPct(d.occupancy)} bokat`,
                    }))}
                    tableHead={['Veckodag', 'Beläggning']}
                    tableRows={s.byWeekday.map((d) => [WEEKDAY_LABELS[d.weekday], fmtPct(d.occupancy)])}
                  />
                  <Tip>Under 40 % en dag i veckan? Fundera på kortare öppettider den dagen, eller ett fast erbjudande.</Tip>
                </Card>
              </div>

              {showOrders && (
                <>
                  <h3 className="sk-section-title" id="meny">
                    Beställningar och meny
                  </h3>
                  <div className="sk-charts">
                    {money && (
                      <Card title={insightTitle('Omsättningen', deltaPct(s.revenue, p?.revenue))} label="Omsättning per dag" wide>
                        <p className="sk-insight">Betalda beställningar och levererad catering per dag, inklusive moms.</p>
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
                    )}

                    <Card title={money ? `${fmtKr(s.avgOrder)} per beställning` : `${fmtInt(s.orders)} beställningar`} label="Beställningarna">
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
                            ...(s.inPersonRevenue ? [{ key: 'card', label: 'Kort i kassan', value: s.inPersonRevenue, tone: 'muted' as const }] : []),
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
                            {(s.cardPayments ?? 0) > 0 && (
                              <>
                                <dt>Kortköp i kassan</dt>
                                <dd>
                                  {fmtInt(s.cardPayments ?? 0)}, {fmtKr(s.cardRevenue)}
                                  {(s.cardRefunds ?? 0) > 0 ? `, ${fmtKr(s.cardRefunded)} återbetalt` : ''}
                                </dd>
                              </>
                            )}
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
                          ? 'Höj snittordern med tillbehör i kassan: dryck, dessert eller en extra sås.'
                          : 'Blir många beställningar klara sent? Säg till ägaren, så kan tidsestimatet höjas vid rusning.'}
                      </Tip>
                    </Card>

                    <Card title="Mest sålda" label="Mest sålda rätter">
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
                      <Card title="Säljer minst" label="Minst sålda rätter">
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

                    {s.pairs.length > 0 && (
                      <Card title="Beställs ofta tillsammans" label="Beställs ofta tillsammans">
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
                        <Tip>Gör ett paketpris av paren som redan säljer ihop, eller föreslå den andra rätten i kassan.</Tip>
                      </Card>
                    )}
                  </div>
                </>
              )}

              {showCatering && (
                <>
                  <h3 className="sk-section-title" id="catering">
                    Catering
                  </h3>
                  <div className="sk-charts">
                    <Card title={s.catering.conversionPct !== null ? `${fmtPct(s.catering.conversionPct)} av offerterna blev beställningar` : 'Från förfrågan till beställning'} label="Catering">
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
                </>
              )}

              {showWeb && (
                <>
                  <h3 className="sk-section-title" id="hemsidan">
                    Hemsidan
                  </h3>
                  <div className="sk-charts">
                    <Card title={s.web.conversionPct !== null ? `${fmtPct(s.web.conversionPct)} av besöken blev en bokning eller beställning` : 'Besök på hemsidan'} label="Hemsidan" wide>
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
                </>
              )}
            </section>

            <p className="sk-foot">
              Bokningar räknas på dagen för besöket, beställningar på dagen de betalades, catering på leveransdagen. Belopp inklusive moms.
              Lunch är före klockan {String(split).padStart(2, '0')}:00.{' '}
              {ready?.builtAt ? `Sammanställt ${new Date(ready.builtAt).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })}, idag räknas direkt.` : ''}
            </p>
          </>
        )}
      </div>
    </>
  )
}
