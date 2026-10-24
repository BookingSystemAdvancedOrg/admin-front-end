import { useEffect, useState } from 'react'
import { ChartTip } from '../../shared/ChartTip'
import { useChartTip } from '../../shared/chartTipState'
import { StatTile } from '../../shared/motion/StatTile'
import { Num } from '../../shared/motion/Num'
import { Loading } from '../../shared/Loading'
import { useTenant } from '../../shared/tenant'
import { trendOf } from '../../shared/trend'
import {
  channelLabel,
  errorText,
  getOverview,
  isoDay,
  kronorFromOre,
  percent,
} from './marketingApi'
import type { Overview } from './marketingApi'
import type { TabId } from './MarknadsforingPage'

const PERIODS = [
  { days: 7, label: '7 dagar' },
  { days: 30, label: '30 dagar' },
  { days: 90, label: '90 dagar' },
] as const

function range(days: number): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - (days - 1))
  return { from: isoDay(from), to: isoDay(to) }
}

/** Besök per dag som staplar (bokningar markerade ovanpå). */
function VisitsChart({ series }: { series: Overview['series'] }) {
  const tip = useChartTip(series.length)
  const max = Math.max(1, ...series.map((d) => d.visits))
  const w = 100 / Math.max(1, series.length)
  const a = tip.active
  const ad = a !== null ? series[a] : null
  return (
    <figure className="mk-chart chart-tip-host" aria-label="Besök per dag">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Besök per dag, högst ${max} besök på en dag`}
        className="chart-tip-surface"
        {...tip.surface}
      >
        {a !== null && <rect x={a * w} y={0} width={w} height={40} className="chart-band" />}
        {series.map((d, i) => {
          const h = (d.visits / max) * 36
          return (
            <rect
              key={d.date}
              x={i * w + w * 0.15}
              y={40 - h}
              width={w * 0.7}
              height={Math.max(h, d.visits ? 0.6 : 0)}
              className={`${d.bookings ? 'mk-bar mk-bar--booked' : 'mk-bar'}${a === i ? ' mk-bar--on' : ''}`}
            />
          )
        })}
        {series.map((d, i) => (
          <rect key={d.date} x={i * w} y={0} width={w} height={40} className="chart-hit" {...tip.hit(i)} />
        ))}
      </svg>
      <ChartTip
        tip={tip}
        at={ad ? { x: a! * w + w / 2, y: 40 - Math.max((ad.visits / max) * 36, 0.6) } : null}
        content={
          ad
            ? {
                heading: dayLabel(ad.date),
                rows: [
                  { label: 'Besök', value: ad.visits.toLocaleString('sv-SE'), tone: 'border' },
                  { label: 'Bokningar', value: ad.bookings.toLocaleString('sv-SE'), tone: 'red' },
                ],
              }
            : null
        }
      />
      <figcaption className="mk-chart-legend">
        <span><i className="mk-dot" /> Besök</span>
        <span><i className="mk-dot mk-dot--booked" /> Dag med bokning via webbplatsen</span>
        <span className="cell-muted">Högst {max} besök på en dag</span>
      </figcaption>
    </figure>
  )
}

/** "2026-10-12" blir "mån 12 okt". */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\./g, '')
}

export function OverviewTab({ onOpen }: { onOpen: (tab: TabId) => void }) {
  const { tenant, locationId } = useTenant()
  const [days, setDays] = useState<number>(30)
  const [allLocations, setAllLocations] = useState(true)
  const multi = (tenant?.locations.length ?? 0) > 1
  const forLocation = allLocations || !multi ? null : locationId
  const key = `${days}|${forLocation ?? ''}`
  // Svaret hör till ett visst urval; ett annat urval visar laddning direkt.
  const [result, setResult] = useState<{ key: string; data?: Overview; error?: string } | null>(null)
  const data = result?.key === key ? (result.data ?? null) : null
  const error = result?.key === key ? (result.error ?? null) : null

  useEffect(() => {
    let cancelled = false
    const { from, to } = range(days)
    getOverview(from, to, forLocation)
      .then((d) => !cancelled && setResult({ key, data: d }))
      .catch((err: unknown) => !cancelled && setResult({ key, error: errorText(err, 'Kunde inte hämta statistiken.') }))
    return () => {
      cancelled = true
    }
  }, [days, forLocation, key])

  const t = data?.totals
  const p = data?.previous
  const against = `de ${days} dagarna innan`
  const tiles = t && p
    ? [
        { label: 'Besök', value: t.visits.toLocaleString('sv-SE'), trend: trendOf(t.visits, p.visits, 'visits', against), note: `${t.pageviews.toLocaleString('sv-SE')} sidvisningar` },
        { label: 'Bokningar via webbplatsen', value: t.bookings.toLocaleString('sv-SE'), trend: trendOf(t.bookings, p.bookings, 'bookings', against), note: `${t.guests} gäster · ${percent(t.bookings, t.visits)} av besöken` },
        { label: 'Beställningar', value: t.orders.toLocaleString('sv-SE'), trend: trendOf(t.orders, p.orders, 'orders', against), note: `${kronorFromOre(t.revenueOre)} i omsättning` },
        { label: 'Prenumeranter', value: data.subscribers.toLocaleString('sv-SE'), trend: undefined, note: `${data.emailsThisMonth} av ${data.monthlyLimit} utskick denna månad` },
      ]
    : []

  return (
    <div className="mk-stack">
      <div className="mk-toolbar">
        <div className="mk-segment" role="group" aria-label="Period">
          {PERIODS.map((x) => (
            <button
              key={x.days}
              type="button"
              aria-pressed={days === x.days}
              className={days === x.days ? 'active' : ''}
              onClick={() => setDays(x.days)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {multi && (
          <select
            className="compact-select"
            aria-label="Platser"
            value={allLocations ? 'all' : 'one'}
            onChange={(e) => setAllLocations(e.target.value === 'all')}
          >
            <option value="all">Alla platser</option>
            <option value="one">Bara vald plats</option>
          </select>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {!data && !error && <Loading label="Hämtar statistiken" />}

      {data && (
        <>
          <section className="stats-row" aria-label="Nyckeltal">
            {tiles.map((tile, i) => (
              <StatTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
                note={tile.note}
                index={i}
                trend={tile.trend}
              />
            ))}
          </section>

          <section className="admin-card table-card">
            <div className="card-head">
              <h2 className="card-title">Besök per dag</h2>
              <span className="cell-muted">Jämfört med föregående {days} dagar</span>
            </div>
            {t && t.visits === 0 ? (
              <p className="cell-muted">
                Inga besök registrerade under perioden. Besök räknas automatiskt på er webbplats, utan cookies.
              </p>
            ) : (
              <VisitsChart series={data.series} />
            )}
          </section>

          <div className="mk-two">
            <section className="admin-card table-card">
              <div className="card-head">
                <h2 className="card-title">Varifrån besökarna kom</h2>
              </div>
              {data.channels.length === 0 ? (
                <p className="cell-muted">Inget att visa än.</p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kanal</th>
                        <th>Besök</th>
                        <th>Bokningar</th>
                        <th>Omsättning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.channels.map((c) => (
                        <tr key={c.channel}>
                          <td className="cell-strong">{channelLabel(c.channel)}</td>
                          <td><Num>{c.visits}</Num></td>
                          <td><Num>{c.bookings}</Num></td>
                          <td><Num>{kronorFromOre(c.revenueOre)}</Num></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="admin-card table-card">
              <div className="card-head">
                <h2 className="card-title">Kampanjer och länkar</h2>
                <button type="button" className="link-btn" onClick={() => onOpen('lankar')}>
                  Skapa spårbar länk →
                </button>
              </div>
              {data.campaigns.length === 0 ? (
                <p className="cell-muted">
                  Inga kampanjbesök än. Skicka ett utskick eller dela en spårbar länk, så syns resultatet här.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Kampanj</th>
                        <th>Besök</th>
                        <th>Bokningar</th>
                        <th>Omsättning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaigns.map((c) => (
                        <tr key={c.campaign}>
                          <td className="cell-strong">
                            {c.campaign}
                            <div className="cell-muted">{channelLabel(c.channel)}</div>
                          </td>
                          <td><Num>{c.visits}</Num></td>
                          <td><Num>{c.bookings}</Num></td>
                          <td><Num>{kronorFromOre(c.revenueOre)}</Num></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <p className="mk-footnote cell-muted">
            Statistiken räknas utan cookies och utan att något sparas hos besökaren, så ingen samtyckesruta
            behövs. Samma person som kommer tillbaka räknas som ett nytt besök.
          </p>
        </>
      )}
    </div>
  )
}
