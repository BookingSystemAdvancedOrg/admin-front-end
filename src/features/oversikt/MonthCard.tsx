import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isApiConfigured } from '../../shared/api'
import { Loading } from '../../shared/Loading'
import { Num } from '../../shared/motion/Num'
import { TrendBadge } from '../../shared/TrendBadge'
import { useTrendPop } from '../../shared/motion/useTrendPop'
import { toneClass, trendOf } from '../../shared/trend'
import type { Trend, TrendMetric } from '../../shared/trend'
import { Ring } from '../statistik/charts'
import { presetRange } from '../statistik/insights'
import type { Filters, InsightsSummary } from '../statistik/insights'
import { fetchInsights } from '../statistik/insightsApi'
import { sampleInsights } from '../statistik/insightsSample'
import { daysBetween, fmtInt, fmtKr, fmtPct, shortDate } from '../statistik/stats'
import '../statistik/statistik.css'

/**
 * "Den här månaden" på Översikt: månaden hittills i fyra siffror och en
 * ring, med en länk till Statistik för diagrammen. Varje siffra jämförs
 * med lika många dagar innan (grön när det går bättre, röd när det går
 * sämre, shared/trend). Samma anrop som Statistik (GET /insights med
 * förra perioden, ett för hela månaden) och samma cache i fliken, så
 * Statistik öppnas direkt efteråt.
 *
 * Månaden hämtas först när kortet syns, så den som bara tittar på dagens
 * bokningar inte belastar API:t. Omsättningen visas bara när svaret har
 * belopp (ägaren).
 */
export function MonthCard({
  locationId,
  today,
  sample,
  showRevenue,
}: {
  locationId: string
  /** Platsens datum idag, YYYY-MM-DD. */
  today: string
  sample: boolean
  /** Restaurangen har beställning eller catering, så omsättning finns att visa. */
  showRevenue: boolean
}) {
  const range = presetRange('month', today)
  const filters: Filters = { preset: 'month', ...range, locationId, service: 'all', channel: 'all', compare: 'previous' }
  const offline = !isApiConfigured()
  const key = `${locationId}|${range.from}|${range.to}|${sample || offline ? 'sample' : 'live'}`
  const ref = useRef<HTMLElement>(null)
  // Utan IntersectionObserver (äldre webbläsare, tester) hämtas månaden direkt.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState<{ key: string; summary: InsightsSummary; previous: InsightsSummary | null; money: boolean } | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  const { from, to } = range
  const useSample = sample || offline
  // Exemplet räknas direkt; bara riktiga siffror hämtas.
  const sampleResponse = useSample ? sampleInsights({ ...filters, from, to }, today, true) : null
  const sampleSummary = sampleResponse?.current ?? null

  useEffect(() => {
    if (!visible || useSample) return
    let cancelled = false
    fetchInsights({ from, to, locationId, service: 'all', channel: 'all', compare: 'previous' })
      .then((r) => !cancelled && setLoaded({ key, summary: r.current, previous: r.previous, money: r.money }))
      .catch(() => !cancelled && setErrorKey(key))
    return () => {
      cancelled = true
    }
  }, [visible, useSample, key, from, to, locationId])

  const s = sampleSummary ?? (loaded?.key === key ? loaded.summary : null)
  const p = sampleResponse ? sampleResponse.previous : loaded?.key === key ? loaded.previous : null
  const days = daysBetween(from, to)
  const against = days === 1 ? 'dagen innan' : `de ${days} dagarna innan`
  const versus = (cur: number | null | undefined, prev: number | null | undefined, metric: TrendMetric) =>
    trendOf(cur, prev, metric, against)
  const money = sampleSummary ? true : loaded?.key === key ? loaded.money : false
  const error = errorKey === key && !s
  const monthName = new Intl.DateTimeFormat('sv-SE', { month: 'long' }).format(new Date(`${today}T12:00:00`))
  const empty = s !== null && s.bookings + s.cancelled === 0 && (s.revenue ?? 0) === 0 && s.orders === 0

  return (
    <section ref={ref} className="admin-card month-card" aria-labelledby="month-card-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="month-card-title">
            Den här månaden
          </h2>
          <p className="month-card-range">
            {range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} till ${shortDate(range.to)}`} · hittills
          </p>
        </div>
        <Link className="card-link" to="/statistik?period=month">
          Hela statistiken →
        </Link>
      </div>

      {error ? (
        <p className="admin-empty">Kunde inte hämta månadens siffror. Försök igen om en stund, eller öppna Statistik.</p>
      ) : !s ? (
        <div className="month-card-loading" role="status">
          <Loading variant="inline" label="Räknar ihop månaden" />
        </div>
      ) : empty ? (
        <p className="admin-empty">
          Inga bokningar eller beställningar än i {monthName}. Siffrorna fylls på här när gästerna börjar boka.
        </p>
      ) : (
        <div className="month-card-body">
          <Ring
            title="Hur bokningarna slutade"
            total={s.bookings + s.cancelled}
            centerLabel="kom"
            empty="Inga bokningar"
            format={fmtInt}
            segments={[
              { key: 'completed', label: 'Genomförda', value: s.bookings - s.noShows, tone: 'ink' },
              { key: 'noshow', label: 'Uteblivna', value: s.noShows, tone: 'red' },
              { key: 'cancelled', label: 'Avbokade', value: s.cancelled, tone: 'steel' },
            ]}
          />
          <dl className="month-card-kpis">
            {showRevenue && money && (
              <div className="month-kpi month-kpi--hero">
                <dt>Omsättning</dt>
                <KpiValue trend={versus(s.revenue, p?.revenue, 'revenue')} index={0}>
                  {fmtKr(s.revenue)}
                </KpiValue>
                <span className="month-kpi-sub">
                  {fmtInt(s.orders)} beställningar{(s.cateringRevenue ?? 0) > 0 ? ' och catering' : ''}
                </span>
              </div>
            )}
            <div className="month-kpi">
              <dt>Bokningar</dt>
              <KpiValue trend={versus(s.bookings, p?.bookings, 'bookings')} index={1}>
                {fmtInt(s.bookings)}
              </KpiValue>
              <span className="month-kpi-sub">{fmtInt(s.cancelled)} avbokade</span>
            </div>
            <div className="month-kpi">
              <dt>Gäster</dt>
              <KpiValue trend={versus(s.guests, p?.guests, 'guests')} index={2}>
                {fmtInt(s.guests)}
              </KpiValue>
              <span className="month-kpi-sub">
                {s.avgParty ? `${s.avgParty.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} per bokning` : 'Inga bokningar än'}
              </span>
            </div>
            <div className={`month-kpi${s.noShowPct !== null && s.noShowPct >= 5 ? ' month-kpi--warn' : ''}`}>
              <dt>Uteblivna</dt>
              <KpiValue trend={versus(s.noShowPct, p?.noShowPct, 'noShows')} index={3} warn={s.noShowPct !== null && s.noShowPct >= 5}>
                {fmtPct(s.noShowPct)}
              </KpiValue>
              <span className="month-kpi-sub">{fmtInt(s.noShows)} bokningar kom inte</span>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}

/** Ett av månadens tal: grönt eller rött mot dagarna innan, med förändringen under. */
function KpiValue({ trend, index, warn = false, children }: { trend: Trend; index: number; warn?: boolean; children: string }) {
  // Varningen (många uteblivna) går före tonen.
  const tone = warn ? 'neutral' : trend.tone
  const ref = useTrendPop<HTMLElement>(tone, 700 + index * 60)
  return (
    <>
      <dd ref={ref} className={toneClass(tone).trim() || undefined}>
        <Num>{children}</Num>
      </dd>
      <TrendBadge trend={trend} className="month-kpi-trend" />
    </>
  )
}
