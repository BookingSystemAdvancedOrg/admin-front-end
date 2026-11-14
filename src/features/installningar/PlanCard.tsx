import type { Tenant } from '../../shared/tenant'
import './planCard.css'

const MONTHS = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
]

const PLAN_NAMES: Record<string, string> = { starter: 'Starter', growth: 'Growth' }

/** "2027-02-14" -> "14 februari 2027" (datumet som det står, ingen tidszon). */
export function svDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d || m > 12) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** Planens namn: "Gratis till 14 februari 2027", "Gratis", "Starter" ... */
export function planLabel(tenant: Pick<Tenant, 'planId' | 'free'>): string {
  if (tenant.planId === 'free') {
    const until = tenant.free?.until
    return until ? `Gratis till ${svDate(until)}` : 'Gratis'
  }
  if (!tenant.planId) return 'Inget abonnemang'
  return PLAN_NAMES[tenant.planId] ?? tenant.planId.charAt(0).toUpperCase() + tenant.planId.slice(1)
}

/** Restaurangens abonnemang hos Booqy (bara visning, ändras av Booqy). */
export function PlanCard({ tenant }: { tenant: Pick<Tenant, 'planId' | 'free'> }) {
  const free = tenant.planId === 'free'
  return (
    <section className="admin-card table-card plan-card" aria-labelledby="plan-card-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="plan-card-title">Abonnemang</h2>
          <p className="plan-card-name">{planLabel(tenant)}</p>
          <p className="cell-muted">
            {free ? 'Inget att betala. SMS ingår.' : 'Fast pris per månad. SMS ingår.'}
          </p>
        </div>
      </div>
    </section>
  )
}
