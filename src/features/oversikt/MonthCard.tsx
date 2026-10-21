import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading } from '../../shared/Loading'
import { Num } from '../../shared/motion/Num'
import type { RequestSummary } from '../catering/cateringApi'
import { Ring } from '../statistik/charts'
import { sampleCatering, sampleDays } from '../statistik/sample'
import { datesIn, fmtInt, fmtKr, fmtPct, presetRange, previousRange, shortDate, summarize } from '../statistik/stats'
import type { Summary } from '../statistik/stats'
import { loadDays } from '../statistik/statsApi'
import '../statistik/statistik.css'

/**
 * "Den här månaden" på Översikt (bara ägaren): månaden hittills i fyra
 * siffror och en ring, med en länk till Statistik för jämförelser och
 * diagram. Underlaget är samma dagslistor som Statistik hämtar, och de
 * delar cache i fliken, så Statistik öppnas direkt efteråt.
 *
 * Månaden hämtas först när kortet syns (upp till 31 dagar, några i taget),
 * så den som bara tittar på dagens bokningar inte belastar API:t. Jämförelsen
 * med förra perioden görs på Statistik, inte här: den skulle dubbla anropen
 * vid varje inloggning.
 */
export function MonthCard({
  locationId,
  today,
  catering,
  sample,
  showRevenue,
}: {
  locationId: string
  /** Platsens datum idag, YYYY-MM-DD. */
  today: string
  /** Cateringförfrågningarna Översikt redan hämtat; null = inga eller okända. */
  catering: RequestSummary[] | null
  sample: boolean
  /** Restaurangen har beställning eller catering, så omsättning finns att visa. */
  showRevenue: boolean
}) {
  const range = presetRange('month', today)
  const key = `${locationId}|${range.from}|${range.to}|${sample ? 'sample' : 'live'}`
  const ref = useRef<HTMLElement>(null)
  // Utan IntersectionObserver (äldre webbläsare, tester) hämtas månaden direkt.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState<{ key: string; summary: Summary; failed: number } | null>(null)
  const [progress, setProgress] = useState<{ key: string; done: number; total: number } | null>(null)
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
  // Exempelläget räknas direkt ur exempeldagarna; inget hämtas.
  // Samma exempelcatering som Statistik väljer för perioden (den räknar från
  // jämförelseperiodens start), så att siffrorna stämmer mellan sidorna.
  const sampleSummary = sample
    ? summarize(sampleDays(from, to, today), sampleCatering(previousRange(from, to).from, to), { from, to })
    : null

  useEffect(() => {
    if (!visible || sample) return
    let cancelled = false
    loadDays(locationId, datesIn(from, to), {
      today,
      concurrency: 3,
      onProgress: (done, total) => !cancelled && setProgress({ key, done, total }),
    })
      .then((result) => {
        if (!cancelled) setLoaded({ key, summary: summarize(result.days, catering ?? [], { from, to }), failed: result.failed })
      })
      .catch(() => {
        if (!cancelled) setErrorKey(key)
      })
    return () => {
      cancelled = true
    }
  }, [visible, key, locationId, from, to, today, sample, catering])

  const s = sample ? sampleSummary : loaded?.key === key ? loaded.summary : null
  const error = !sample && errorKey === key && !s
  const failed = !sample && loaded?.key === key ? loaded.failed : 0
  const step = progress?.key === key ? progress : null
  const monthName = new Intl.DateTimeFormat('sv-SE', { month: 'long' }).format(new Date(`${today}T12:00:00`))
  const empty = s !== null && s.bookings + s.cancelled === 0 && s.revenue === 0

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
          <Loading variant="inline" label={step && step.total > 0 ? `Räknar ihop ${step.done} av ${step.total} dagar` : 'Räknar ihop månaden'} />
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
              { key: 'completed', label: 'Genomförda', value: s.completed, tone: 'ink' },
              { key: 'noshow', label: 'Uteblivna', value: s.noShows, tone: 'red' },
              { key: 'cancelled', label: 'Avbokade', value: s.cancelled, tone: 'steel' },
            ]}
          />
          <dl className="month-card-kpis">
            {showRevenue && (
              <div className="month-kpi month-kpi--hero">
                <dt>Omsättning</dt>
                <dd>
                  <Num>{fmtKr(s.revenue)}</Num>
                </dd>
                <span className="month-kpi-sub">
                  {fmtInt(s.orders)} beställningar{s.cateringRevenue > 0 ? ' och catering' : ''}
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
      {s && failed > 0 && (
        <p className="month-card-note">
          {failed === 1 ? 'En dag' : `${failed} dagar`} kunde inte hämtas, så siffrorna kan vara för låga.
        </p>
      )}
    </section>
  )
}
