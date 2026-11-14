import { useLiveRefresh } from '../../shared/live'
import { useEffect, useState } from 'react'
import { StatTile } from '@booqy/brand'
import { getInsights, type Insights } from './api'

/** Översikt: vad annonserna kostade och gav under vald period. */
export default function AdsOverviewTiles({ locationId, from, to }: { locationId: string | null; from: string; to: string }) {
  const [data, setData] = useState<Insights | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getInsights(locationId, from, to).then((d) => { if (!cancelled) setData(d) }).catch(() => { if (!cancelled) setData(null) })
    return () => { cancelled = true }
  }, [locationId, from, to])
  useLiveRefresh(async () => {
    if (locationId) setData(await getInsights(locationId, from, to))
  }, { enabled: Boolean(locationId) })

  if (!locationId || !data || data.rows.length === 0) return null
  const kr = (v: number | null) => (v === null ? '-' : `${v.toLocaleString('sv-SE')} kr`)
  return (
    <div className="stats-row" aria-label="Annonser">
      <StatTile index={0} label="Annonskostnad" value={kr(data.totals.spendSek)} note={`${data.totals.clicks} klick`} />
      <StatTile index={1} label="Kostnad per bokning" value={kr(data.totals.costPerBookingSek)} note={`${data.totals.bookings} bokningar från annonser`} />
      <StatTile index={2} label="Kostnad per beställning" value={kr(data.totals.costPerOrderSek)} note={`${data.totals.orders} beställningar från annonser`} />
    </div>
  )
}
