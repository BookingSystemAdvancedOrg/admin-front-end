import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SkelBlock, SkelBox, SkelCard, SkelPage } from '../../shared/Skeleton'
import { ColumnChart } from './charts'
import { WEEKDAY_LABELS } from './insights'
import type { DayPoint, InsightsResponse } from './insights'
import { fetchInsights, insightsQuery } from './insightsApi'
import type { InsightsQuery } from './insightsApi'
import { sampleInsights } from './insightsSample'
import { Card, Tile, Tip } from './parts'
import { useLiveRefresh } from './live'
import { addDays, datesIn, fmtDecimal, fmtInt, fmtPct, shortDate, weekdayOf } from './stats'
import { WEEKS, byWeek } from './weeks'
import { ErrorNote } from '../../shared/ErrorNote'
import { booqyFaultText } from '../../shared/errors'

/**
 * Det viktigaste för ägaren och personalen, alltid överst och alltid live,
 * oberoende av perioden längre ner: idag, de kommande bokningarna, gäster
 * per vecka och uteblivna. Ett anrop: de senaste åtta veckorna plus sju
 * dagar framåt (servern räknar idag och framåt direkt ur bokningarna).
 */

const AHEAD = 7
const NO_SHOW_DAYS = 30

export function Overview({ locationId, today, money, sample, sampleName }: {
  locationId: string
  today: string
  money: boolean
  sample: boolean
  sampleName: string
}) {
  const monday = addDays(today, -weekdayOf(today))
  const q: InsightsQuery = {
    from: addDays(monday, -7 * (WEEKS - 1)),
    to: today,
    locationId,
    service: 'all',
    channel: 'all',
    compare: 'none',
    ahead: AHEAD,
  }
  const key = `${insightsQuery(q)}|${sample ? 'sample' : 'live'}`
  const [loaded, setLoaded] = useState<{ key: string; data: InsightsResponse } | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useLiveRefresh(() => setTick((n) => n + 1), !sample)

  useEffect(() => {
    if (sample) return
    let cancelled = false
    fetchInsights(q, { fresh: tick > 0 })
      .then((data) => !cancelled && setLoaded({ key, data }))
      .catch(() => !cancelled && setErrorKey(key))
    return () => {
      cancelled = true
    }
    // q följer key; tick hämtar om samma sak
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, sample])

  const data = sample
    ? sampleInsights({ ...q, preset: 'custom' }, today, money, sampleName)
    : loaded?.key === key
      ? loaded.data
      : null
  const error = errorKey === key && !data

  if (error) {
    return (
      <ErrorNote text={booqyFaultText('Kunde inte hämta dagens siffror.')} />
    )
  }
  if (!data) {
    return (
      <SkelPage label="Hämtar dagens siffror">
        <section className="sk-block" aria-hidden="true">
          <SkelBlock w={120} h={22} />
          <div className="sk-kpis sk-kpis--four">
            {[0, 1, 2, 3].map((i) => (
              <SkelBox key={i} className="admin-card sk-kpi">
                <SkelBlock w="44%" h={12} />
                <SkelBlock w="36%" h={36} style={{ borderRadius: 'var(--r-md)' }} />
              </SkelBox>
            ))}
          </div>
          <SkelCard chart aside={false} />
        </section>
      </SkelPage>
    )
  }

  const s = data.current
  const day: DayPoint = s.byDay.find((d) => d.date === today) ?? {
    date: today, bookings: 0, guests: 0, arrived: 0, orders: 0, noShows: 0, cancelled: 0, visits: 0, occupancy: null,
  }
  const upcoming = data.upcoming ?? datesIn(addDays(today, 1), addDays(today, AHEAD)).map((date) => ({ date, bookings: 0, guests: 0 }))
  const aheadGuests = upcoming.reduce((n, u) => n + u.guests, 0)
  const aheadBookings = upcoming.reduce((n, u) => n + u.bookings, 0)
  const weeks = byWeek(s.byDay, upcoming, today)
  const thisWeek = weeks[weeks.length - 1]
  const lastWeek = weeks[weeks.length - 2]
  // Uteblivna: de senaste 30 avslutade dagarna (idag är inte över än).
  const past = s.byDay.filter((d) => d.date < today && d.date >= addDays(today, -NO_SHOW_DAYS))
  const pastBookings = past.reduce((n, d) => n + d.bookings, 0)
  const pastNoShows = past.reduce((n, d) => n + d.noShows, 0)
  const noShowPct = pastBookings > 0 ? (pastNoShows / pastBookings) * 100 : null
  const dayLabel = (iso: string) => `${WEEKDAY_LABELS[weekdayOf(iso)]} ${shortDate(iso)}`

  return (
    <section aria-label="Idag" className="sk-block sk-overview">
      <div className="sk-kpis sk-kpis--four">
        <Tile
          label="Bokningar idag"
          value={fmtInt(day.bookings)}
          detail={day.cancelled ? `Idag: ${fmtInt(day.cancelled)} avbokade` : undefined}
          info="Dagens bokningar som inte är avbokade: de som väntas, de som har kommit och de som uteblev. Online, telefon och drop-in räknas lika."
        />
        <Tile
          label="Gäster idag"
          value={fmtInt(day.guests)}
          detail={day.bookings ? `Idag: ${fmtDecimal(day.guests / day.bookings)} per sällskap` : undefined}
          info="Antal personer i dagens bokningar (sällskapens storlek), avbokade räknas inte."
        />
        <Tile
          label="Har kommit"
          value={fmtInt(day.arrived)}
          detail={`Idag: ${fmtInt(day.arrived)} av ${fmtInt(day.bookings)} bokningar.`}
          info="Bokningar som personalen har markerat som Kommit idag. Den som inte markeras räknas inte här."
        />
        <Tile
          label="Beläggning idag"
          value={fmtPct(day.occupancy)}
          info="Hur stor del av alla bords tid under dagens öppettider som är bokad. 100 % betyder att varje bord är bokat hela dagen."
        />
      </div>

      <div className="sk-charts">
        <Card
          title={`${fmtInt(aheadGuests)} gäster bokade kommande ${AHEAD} dagar`}
          label="Kommande bokningar"
          info={`Bokningar som ligger inne för de ${AHEAD} dagarna efter idag, utan avbokade. Visas direkt när någon bokar.`}
        >
          <p className="sk-insight">
            {fmtInt(aheadBookings)} bokningar
          </p>
          <ColumnChart
            unit="count"
            format={fmtInt}
            seriesLabel="Gäster"
            ariaLabel="Bokade gäster de kommande dagarna"
            points={upcoming.map((u) => ({
              key: u.date,
              label: WEEKDAY_LABELS[weekdayOf(u.date)],
              value: u.guests,
              detail: `${fmtInt(u.bookings)} bokningar`,
              title: `${dayLabel(u.date)}: ${fmtInt(u.guests)} gäster i ${fmtInt(u.bookings)} bokningar`,
            }))}
            tableHead={['Dag', 'Gäster', 'Bokningar']}
            tableRows={upcoming.map((u) => [dayLabel(u.date), u.guests, u.bookings])}
          />
          <Link className="card-link" to="/bokningar">
            Till bokningarna →
          </Link>
        </Card>

        <Card
          title={`${fmtInt(thisWeek.guests)} gäster vecka ${thisWeek.week}`}
          label="Gäster per vecka"
          info="Gäster i bokningar som inte är avbokade, per vecka från måndag till söndag. Denna vecka räknar dagarna som varit och det som redan är bokat resten av veckan. Uteblivna räknas med."
        >
          <p className="sk-insight">
            Förra veckan {fmtInt(lastWeek.guests)}
          </p>
          <ColumnChart
            unit="count"
            format={fmtInt}
            seriesLabel="Gäster"
            ariaLabel="Gäster per vecka"
            points={weeks.map((w) => ({
              key: w.start,
              label: `v.${w.week}`,
              value: w.guests,
              detail: `${fmtInt(w.bookings)} bokningar`,
              title: `Vecka ${w.week}: ${fmtInt(w.guests)} gäster i ${fmtInt(w.bookings)} bokningar${w.ahead ? `, varav ${fmtInt(w.ahead)} bokade framåt` : ''}`,
            }))}
            tableHead={['Vecka', 'Gäster', 'Bokningar']}
            tableRows={weeks.map((w) => [`v.${w.week} (från ${shortDate(w.start)})`, w.guests, w.bookings])}
          />
        </Card>

        <Card
          title={noShowPct !== null ? `${fmtPct(noShowPct)} uteblev de senaste ${NO_SHOW_DAYS} dagarna` : 'Uteblivna'}
          label="Uteblivna"
          info={`Bokningar som personalen markerat som Kom inte, delat med alla bokningar som inte avbokats, de senaste ${NO_SHOW_DAYS} dagarna före idag. Avbokningar räknas inte som uteblivna.`}
          wide
        >
          <p className="sk-insight">
            {fmtInt(pastNoShows)} av {fmtInt(pastBookings)} bokningar
          </p>
          <ColumnChart
            unit="count"
            format={fmtInt}
            seriesLabel="Uteblivna"
            ariaLabel="Uteblivna per vecka"
            points={weeks.map((w) => ({
              key: w.start,
              label: `v.${w.week}`,
              value: w.noShows,
              title: `Vecka ${w.week}: ${fmtInt(w.noShows)} uteblivna`,
            }))}
            tableHead={['Vecka', 'Uteblivna']}
            tableRows={weeks.map((w) => [`v.${w.week} (från ${shortDate(w.start)})`, w.noShows])}
          />
          <Tip>
            {noShowPct !== null && noShowPct >= 5
              ? 'Över 5 % uteblir. Kräv kortgaranti för större sällskap och skicka en påminnelse dagen före.'
              : 'Markera Kommit och Kom inte i Bokningar, så blir siffran rätt. Under 5 % är bra.'}
          </Tip>
        </Card>
      </div>
    </section>
  )
}
