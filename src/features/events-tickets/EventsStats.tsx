import { StatTile } from '@booqy/brand'
import { kr } from './api'
import './evenemang.css'

interface Day { day: string; occurrences: number; ticketsSold: number; revenueOre?: number; checkedIn: number }

/**
 * Statistik-platsen "statistik.events": sålda biljetter, intäkt (bara ägaren:
 * servern tar bort beloppen för personal) och andel insläppta. Visas först
 * när insights skickar `events` per dag (insights.events, hotspot i Run 2);
 * utan data visas ingenting.
 */
export default function EventsStats({ insights }: { insights?: unknown; locationId?: string; from?: string; to?: string }) {
  const days = ((insights as { events?: Day[] } | undefined)?.events) ?? []
  if (!days.length) return null
  const sold = days.reduce((s, d) => s + d.ticketsSold, 0)
  const occurrences = days.reduce((s, d) => s + d.occurrences, 0)
  const checkedIn = days.reduce((s, d) => s + d.checkedIn, 0)
  const revenue = days.some((d) => d.revenueOre !== undefined) ? days.reduce((s, d) => s + (d.revenueOre ?? 0), 0) : null
  return (
    <>
      <h3 className="sk-section-title" id="evenemang">Evenemang</h3>
      <div className="evenemang-tiles">
        <StatTile label="Sålda biljetter" value={String(sold)} index={0} />
        {revenue !== null ? <StatTile label="Biljettintäkt" value={kr(revenue)} index={1} /> : null}
        <StatTile label="Tillfällen" value={String(occurrences)} index={2} />
        <StatTile label="Insläppta" value={sold ? `${Math.round((checkedIn / Math.max(sold, 1)) * 100)} %` : '-'} index={3} />
      </div>
    </>
  )
}
