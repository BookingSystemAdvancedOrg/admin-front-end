import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { isApiConfigured } from '../../shared/api'
import { Loading } from '../../shared/Loading'
import { Num } from '../../shared/motion/Num'
import { Ring } from '../statistik/charts'
import { presetRange } from '../statistik/insights'
import type { Filters, InsightsSummary } from '../statistik/insights'
import { fetchInsights } from '../statistik/insightsApi'
import { sampleInsights } from '../statistik/insightsSample'
import { fmtInt, fmtKr, fmtPct, shortDate } from '../statistik/stats'
import '../statistik/statistik.css'

/**
 * "Den här månaden" på Översikt: månaden hittills i fyra siffror och en
 * ring, med en länk till Statistik för jämförelser och diagram. Samma
 * anrop som Statistik (GET /insights, ett för hela månaden) och samma
 * cache i fliken, så Statistik öppnas direkt efteråt.
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
  const filters: Filters = { preset: 'month', ...range, locationId, service: 'all', channel: 'all', compare: 'none' }
  const offline = !isApiConfigured()
  const key = `${locationId}|${range.from}|${range.to}|${sample || offline ? 'sample' : 'live'}`
  const ref = useRef<HTMLElement>(null)
  // Utan IntersectionObserver (äldre webbläsare, tester) hämtas månaden direkt.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState<{ key: string; summary: InsightsSummary; money: boolean } | null>(null)
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
  const sampleSummary = useSample ? sampleInsights({ ...filters, from, to }, today, true).current : null

  useEffect(() => {
    if (!visible || useSample) return
    let cancelled = false
    fetchInsights({ from, to, locationId, service: 'all', channel: 'all', compare: 'none' })
      .then((r) => !cancelled && setLoaded({ key, summary: r.current, money: r.money }))
      .catch(() => !cancelled && setErrorKey(key))
    return () => {
      cancelled = true
    }
  }, [visible, useSample, key, from, to, locationId])

  const s = sampleSummary ?? (loaded?.key === key ? loaded.summary : null)
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
                <dd>
                  <Num>{fmtKr(s.revenue)}</Num>
                </dd>
                <span className="month-kpi-sub">
                  {fmtInt(s.orders)} beställningar{(s.cateringRevenue ?? 0) > 0 ? ' och catering' : ''}
                </span>
              </div>
            )}
            <div className="month-kpi">
              <dt>Bokningar</dt>
              <dd>
                <Num>{fmtInt(s.bookings)}</Num>
              </dd>
              <span className="month-kpi-sub">{fmtInt(s.cancelled)} avbokade</span>
            </div>
            <div className="month-kpi">
              <dt>Gäster</dt>
              <dd>
                <Num>{fmtInt(s.guests)}</Num>
              </dd>
              <span className="month-kpi-sub">
                {s.avgParty ? `${s.avgParty.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} per bokning` : 'Inga bokningar än'}
              </span>
            </div>
            <div className={`month-kpi${s.noShowPct !== null && s.noShowPct >= 5 ? ' month-kpi--warn' : ''}`}>
              <dt>Uteblivna</dt>
              <dd>
                <Num>{fmtPct(s.noShowPct)}</Num>
              </dd>
              <span className="month-kpi-sub">{fmtInt(s.noShows)} bokningar kom inte</span>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}
