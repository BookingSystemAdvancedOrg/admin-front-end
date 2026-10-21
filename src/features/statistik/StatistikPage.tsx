import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { Loading } from '../../shared/Loading'
import { Num } from '../../shared/motion/Num'
import { currentLocation, useTenant } from '../../shared/tenant'
import { todayIn } from '../bokningar/bookingsApi'
import { listRequests } from '../catering/cateringApi'
import type { RequestSummary } from '../catering/cateringApi'
import { sampleModeOn, setSampleMode } from '../oversikt/sample'
import { BarChart, ColumnChart, Delta, Ring } from './charts'
import { sampleCatering, sampleDays } from './sample'
import {
  PRESETS,
  datesIn,
  deltaPct,
  fmtDecimal,
  fmtInt,
  fmtKr,
  fmtPct,
  insightTitle,
  presetRange,
  previousRange,
  rangeLabel,
  shortDate,
  summarize,
} from './stats'
import type { PresetId, Summary } from './stats'
import { loadDays } from './statsApi'
import './statistik.css'

/**
 * Statistik: restaurangens egna siffror för en period, med förra perioden
 * som jämförelse. Samma upplägg som Booqy Consoles Finance-sida (hjälte,
 * ringar, nyckeltal, diagram), men med det en restaurang kan påverka:
 * omsättning, bokningar, uteblivna gäster, när gästerna kommer och vad de
 * beställer. Bara för ägaren.
 *
 * Underlaget hämtas dag för dag (statsApi) eftersom API:t saknar
 * sammanställningar; först perioden, sedan perioden före för jämförelsen.
 * I exempelläget (Översiktens val) visas en påhittad restaurang i stället.
 */

interface Loaded {
  key: string
  current: Summary
  previous: Summary | null
  failed: number
}

function Kpi({
  label,
  value,
  sub,
  delta,
  tone,
}: {
  label: string
  value: string
  sub?: string
  delta?: React.ReactNode
  tone?: 'warn' | 'bad'
}) {
  return (
    <div className={`admin-card sk-kpi${tone ? ` sk-kpi--${tone}` : ''}`}>
      <span className="sk-kpi-label">{label}</span>
      <strong className="sk-kpi-value">
        <Num>{value}</Num>
      </strong>
      {sub && <span className="sk-kpi-sub">{sub}</span>}
      {delta}
    </div>
  )
}

export default function StatistikPage() {
  const tenantState = useTenant()
  const { tenant, locationId } = tenantState
  const location = currentLocation(tenantState)
  const isOwner = tenant?.role === 'owner_user'
  const hasOrdering = Boolean(tenant?.entitlements.features.ordering)
  const hasCatering = Boolean(tenant?.entitlements.features.catering)
  const [sample, setSample] = useState(sampleModeOn)
  const chooseSample = (on: boolean) => {
    setSampleMode(on)
    setSample(on)
  }
  const timezone = location?.timezone ?? null
  const today = todayIn(timezone)

  // Perioden står i adressen (?period=month), så Översiktens länk, en
  // omladdning och ett bokmärke öppnar samma period.
  const [params, setParams] = useSearchParams()
  const fromUrl = params.get('period')
  const preset: PresetId = PRESETS.some((pr) => pr.id === fromUrl) ? (fromUrl as PresetId) : 'd30'
  const setPreset = (id: PresetId) => setParams({ period: id }, { replace: true })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState(false)

  const range = useMemo(() => presetRange(preset, today), [preset, today])
  const before = useMemo(() => previousRange(range.from, range.to), [range])
  const key = `${locationId}|${range.from}|${range.to}|${sample ? 'sample' : 'live'}`

  useEffect(() => {
    if (!locationId || !isOwner) return
    let cancelled = false

    const run = async () => {
      setError(false)
      setProgress({ done: 0, total: 0 })
      if (sample) {
        const catering = sampleCatering(before.from, range.to)
        setLoaded({
          key,
          current: summarize(sampleDays(range.from, range.to, today), catering, range),
          previous: summarize(sampleDays(before.from, before.to, today), catering, before),
          failed: 0,
        })
        setProgress(null)
        return
      }
      const catering: RequestSummary[] = hasCatering ? await listRequests(locationId).catch(() => []) : []
      const dates = datesIn(range.from, range.to)
      const now = await loadDays(locationId, dates, {
        today,
        onProgress: (done, total) => !cancelled && setProgress({ done, total }),
      })
      if (cancelled) return
      const current = summarize(now.days, catering, range)
      setLoaded({ key, current, previous: null, failed: now.failed })
      setProgress(null)
      const prev = await loadDays(locationId, datesIn(before.from, before.to), { today })
      if (cancelled) return
      setLoaded({ key, current, previous: summarize(prev.days, catering, before), failed: now.failed + prev.failed })
    }
    run().catch(() => {
      if (!cancelled) {
        setError(true)
        setProgress(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [locationId, isOwner, key, range, before, today, hasCatering, sample])

  if (!isOwner) {
    return (
      <>
        <AdminTopbar title="Statistik" />
        <div className="admin-main">
          <section className="admin-card table-card tenant-notice">
            <h2 className="card-title">Bara för ägaren</h2>
            <p className="cell-muted">Statistiken visar restaurangens siffror och är bara öppen för restaurangens ägare.</p>
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

  const ready = loaded?.key === key ? loaded : null
  const s = ready?.current ?? null
  const p = ready?.previous ?? null
  const comparing = !!ready && ready.previous === null
  const orderShare = s && s.revenue > 0 ? (s.orderRevenue / s.revenue) * 100 : null
  const revenuePct = deltaPct(s?.revenue, p?.revenue)
  const bookingsPct = deltaPct(s?.bookings, p?.bookings)
  const peakHour = s?.byHour.reduce<{ hour: number; bookings: number } | null>((best, h) => (!best || h.bookings > best.bookings ? h : best), null) ?? null
  const peakDay = s?.byWeekday.reduce((best, d) => (d.guests > best.guests ? d : best), s.byWeekday[0]) ?? null

  const dayLabel = (iso: string) => shortDate(iso)

  return (
    <>
      <AdminTopbar title="Statistik" />
      <div className="admin-main">
        <div className="sk-toolbar" role="group" aria-label="Period">
          <div className="sk-chips">
            {PRESETS.map((pr) => (
              <button key={pr.id} type="button" className="sk-chip" aria-pressed={preset === pr.id} onClick={() => setPreset(pr.id)}>
                {pr.label}
              </button>
            ))}
          </div>
          <span className="sk-period">
            {rangeLabel(range.from, range.to)} · jämförs med {rangeLabel(before.from, before.to)}
          </span>
          {progress && progress.total > 0 && (
            <span className="sk-progress" role="status">
              {progress.done} av {progress.total} dagar
            </span>
          )}
        </div>

        {sample && (
          <div className="sample-notice" role="status">
            <span className="sample-stamp">Exempel</span>
            <span>Du ser exempeldata, inte restaurangens riktiga siffror.</span>
            <button type="button" className="link-action" onClick={() => chooseSample(false)}>
              Visa riktiga siffror
            </button>
          </div>
        )}
        {s && !sample && s.bookings === 0 && s.cancelled === 0 && s.orders === 0 && (
          <p className="cell-muted">
            Inga bokningar eller beställningar i perioden än.
            <button type="button" className="sample-offer" onClick={() => chooseSample(true)}>
              Visa med exempeldata
            </button>
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

        {s && (
          <>
            {ready && ready.failed > 0 && (
              <p className="form-error" role="status">
                {ready.failed} {ready.failed === 1 ? 'dag' : 'dagar'} kunde inte hämtas helt; siffrorna är ofullständiga.
              </p>
            )}

            <section className="sk-hero" aria-label="Perioden i korthet">
              <div className="admin-card sk-kpi sk-kpi--hero">
                <span className="sk-kpi-label">Omsättning</span>
                <strong className="sk-kpi-value">
                  <Num>{fmtKr(s.revenue)}</Num>
                </strong>
                <span className="sk-kpi-insight">
                  {s.revenue === 0
                    ? hasOrdering
                      ? 'Inga betalda beställningar i perioden än.'
                      : 'Beställning ingår inte i er plan, så omsättningen här är catering.'
                    : s.cateringRevenue > 0
                      ? `Beställningar står för ${fmtPct(orderShare)}, catering för resten.`
                      : `${fmtInt(s.orders)} betalda beställningar, ${fmtKr(s.avgOrder)} per nota i snitt.`}
                </span>
                <Delta pct={revenuePct} pending={comparing} />
                <dl className="sk-facts">
                  <dt>Beställningar</dt>
                  <dd>{fmtKr(s.orderRevenue)}</dd>
                  <dt>Catering</dt>
                  <dd>{fmtKr(s.cateringRevenue)}</dd>
                  <dt>Period</dt>
                  <dd>
                    {rangeLabel(s.from, s.to)}, {s.days} dagar
                  </dd>
                </dl>
              </div>
              <div className="admin-card sk-rings">
                <Ring
                  title="Var pengarna kommer ifrån"
                  total={s.revenue}
                  centerLabel="avhämtning"
                  empty="Inget betalt än"
                  format={fmtKr}
                  segments={[
                    { key: 'pickup', label: 'Avhämtning', value: s.pickupRevenue, tone: 'ink' },
                    { key: 'table', label: 'Vid bordet', value: s.tableRevenue, tone: 'red' },
                    { key: 'catering', label: 'Catering', value: s.cateringRevenue, tone: 'steel' },
                  ]}
                />
                <Ring
                  title="Hur gästerna bokar"
                  total={s.bookings}
                  centerLabel="online"
                  empty="Inga bokningar"
                  format={fmtInt}
                  segments={[
                    { key: 'online', label: 'Online', value: s.source.online, tone: 'ink' },
                    { key: 'phone', label: 'Telefon', value: s.source.phone, tone: 'red' },
                    { key: 'onsite', label: 'På plats', value: s.source.onsite, tone: 'steel' },
                  ]}
                />
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
              </div>
            </section>

            <section className="sk-kpis" aria-label="Nyckeltal">
              <Kpi
                label="Bokningar"
                value={fmtInt(s.bookings)}
                sub={`${fmtInt(s.guests)} gäster · ${fmtDecimal(s.avgParty)} per sällskap`}
                delta={<Delta pct={bookingsPct} pending={comparing} />}
              />
              <Kpi
                label="Uteblivna"
                value={fmtPct(s.noShowPct ?? 0)}
                sub={`${fmtInt(s.noShows)} av ${fmtInt(s.bookings)} bokningar`}
                tone={s.noShowPct !== null && s.noShowPct >= 10 ? 'bad' : s.noShowPct !== null && s.noShowPct >= 5 ? 'warn' : undefined}
                delta={<Delta pct={deltaPct(s.noShowPct, p?.noShowPct)} invert pending={comparing} />}
              />
              <Kpi
                label="Avbokade"
                value={fmtInt(s.cancelled)}
                sub={`${fmtPct(s.cancelledPct ?? 0)} av alla bokningar · ${fmtPct(s.cardOnFilePct ?? 0)} med kortgaranti`}
                delta={<Delta pct={deltaPct(s.cancelled, p?.cancelled)} invert pending={comparing} />}
              />
              <Kpi
                label="Snittnota"
                value={fmtKr(s.avgOrder)}
                sub={hasOrdering || sample ? `${fmtInt(s.orders)} betalda beställningar` : 'Beställning ingår inte i er plan'}
                delta={<Delta pct={deltaPct(s.avgOrder, p?.avgOrder)} pending={comparing} />}
              />
            </section>

            <div className="sk-charts">
              <section className="admin-card" aria-label="Omsättning per dag">
                <h2 className="card-title">{insightTitle('Omsättningen', revenuePct)}</h2>
                <p className="sk-insight">
                  {p && p.revenue > 0
                    ? `${fmtKr(s.orderRevenue)} mot ${fmtKr(p.orderRevenue)} förra perioden; staplar är den här periodens beställningar per dag, linjen förra periodens.`
                    : 'Betalda beställningar per dag.'}
                </p>
                <ColumnChart
                  unit="kr"
                  format={fmtKr}
                  seriesLabel="Den här perioden"
                  previousLabel={p ? 'Förra perioden' : undefined}
                  ariaLabel="Omsättning per dag"
                  points={s.byDay.map((d, i) => ({
                    key: d.date,
                    label: dayLabel(d.date),
                    value: d.revenue,
                    previous: p?.byDay[i]?.revenue,
                    title: `${dayLabel(d.date)}: ${fmtKr(d.revenue)} (${fmtInt(d.orders)} beställningar)${p?.byDay[i] ? `, förra perioden ${fmtKr(p.byDay[i].revenue)}` : ''}`,
                  }))}
                  tableHead={['Dag', 'Omsättning', 'Beställningar', 'Förra perioden']}
                  tableRows={s.byDay.map((d, i) => [dayLabel(d.date), fmtKr(d.revenue), d.orders, p?.byDay[i] ? fmtKr(p.byDay[i].revenue) : '-'])}
                />
              </section>

              <section className="admin-card" aria-label="Bokningar per dag">
                <h2 className="card-title">{insightTitle('Bokningarna', bookingsPct)}</h2>
                <p className="sk-insight">
                  {peakDay && peakDay.guests > 0
                    ? `${peakDay.label === 'Sön' ? 'Söndagar' : `${peakDay.label.toLowerCase()}dagar`} tar flest gäster (${fmtInt(peakDay.guests)} i perioden). Staplar är bokningar per dag, linjen förra periodens.`
                    : 'Bokningar per dag, avbokade borträknade.'}
                </p>
                <ColumnChart
                  unit="count"
                  format={fmtInt}
                  seriesLabel="Bokningar"
                  previousLabel={p ? 'Förra perioden' : undefined}
                  ariaLabel="Bokningar per dag"
                  points={s.byDay.map((d, i) => ({
                    key: d.date,
                    label: dayLabel(d.date),
                    value: d.bookings,
                    previous: p?.byDay[i]?.bookings,
                    title: `${dayLabel(d.date)}: ${fmtInt(d.bookings)} bokningar, ${fmtInt(d.guests)} gäster${p?.byDay[i] ? `, förra perioden ${fmtInt(p.byDay[i].bookings)}` : ''}`,
                  }))}
                  tableHead={['Dag', 'Bokningar', 'Gäster', 'Förra perioden']}
                  tableRows={s.byDay.map((d, i) => [dayLabel(d.date), d.bookings, d.guests, p?.byDay[i]?.bookings ?? '-'])}
                />
              </section>

              <section className="admin-card" aria-label="Mest bokade tider">
                <h2 className="card-title">
                  {peakHour ? `Flest bokningar klockan ${String(peakHour.hour).padStart(2, '0')}` : 'När gästerna bokar'}
                </h2>
                <p className="sk-insight">Bokningar per starttimme i perioden. Bra att veta när ni sätter personal och öppettider.</p>
                <BarChart
                  format={fmtInt}
                  ariaLabel="Bokningar per timme"
                  rows={s.byHour.map((h) => ({
                    key: String(h.hour),
                    label: `${String(h.hour).padStart(2, '0')}:00`,
                    value: h.bookings,
                    title: `${String(h.hour).padStart(2, '0')}:00: ${fmtInt(h.bookings)} bokningar`,
                  }))}
                  tableHead={['Timme', 'Bokningar']}
                  tableRows={s.byHour.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.bookings])}
                />
              </section>

              <section className="admin-card" aria-label="Gäster per veckodag">
                <h2 className="card-title">Gäster per veckodag</h2>
                <p className="sk-insight">Gäster som bokat, per veckodag i perioden. Den tyngsta dagen i rött.</p>
                <BarChart
                  format={fmtInt}
                  ariaLabel="Gäster per veckodag"
                  rows={s.byWeekday.map((d) => ({
                    key: d.label,
                    label: d.label,
                    value: d.guests,
                    title: `${d.label}: ${fmtInt(d.guests)} gäster i ${fmtInt(d.bookings)} bokningar`,
                  }))}
                  tableHead={['Veckodag', 'Gäster', 'Bokningar']}
                  tableRows={s.byWeekday.map((d) => [d.label, d.guests, d.bookings])}
                />
              </section>

              <section className="admin-card" aria-label="Mest sålda rätter">
                <h2 className="card-title">Mest sålda</h2>
                <p className="sk-insight">Rätter i betalda beställningar, flest sålda först.</p>
                {s.topDishes.length === 0 ? (
                  <p className="sk-empty">Inga beställningar i perioden.</p>
                ) : (
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
                        <th scope="col" className="num">
                          Omsättning
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.topDishes.map((d, i) => (
                        <tr key={d.name}>
                          <td className="sk-rank">{i + 1}</td>
                          <td>{d.name}</td>
                          <td className="num">{fmtInt(d.quantity)}</td>
                          <td className="num">{fmtKr(d.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="admin-card" aria-label="Catering">
                <h2 className="card-title">Catering</h2>
                <p className="sk-insight">
                  {hasCatering || sample
                    ? 'Nya förfrågningar som kom in i perioden, och leveranser som vunnits i den.'
                    : 'Catering ingår inte i er plan.'}
                </p>
                <dl className="sk-facts">
                  <dt>Förfrågningar</dt>
                  <dd>
                    {fmtInt(s.cateringRequests)}
                    {p ? ` (förra perioden ${fmtInt(p.cateringRequests)})` : ''}
                  </dd>
                  <dt>Vunna leveranser</dt>
                  <dd>{fmtInt(s.cateringWon)}</dd>
                  <dt>Värde</dt>
                  <dd>{fmtKr(s.cateringRevenue)}</dd>
                </dl>
                {(hasCatering || sample) && (
                  <Link className="card-link" to="/catering">
                    Till förfrågningarna →
                  </Link>
                )}
              </section>
            </div>

            <p className="sk-foot">
              Bokningar och betalda beställningar per dag på {location?.name || 'platsen'}, catering med leverans i perioden. Belopp inklusive moms.
              Förra perioden är lika många dagar direkt före.
            </p>
          </>
        )}
      </div>
    </>
  )
}
