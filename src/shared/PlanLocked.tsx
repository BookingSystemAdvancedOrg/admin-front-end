import { Link } from 'react-router-dom'

/** Samma kort på alla sidor som inte ingår i restaurangens plan, med väg vidare. */
export function PlanLocked() {
  return (
    <section className="admin-card table-card tenant-notice">
      <h2 className="card-title">Ingår inte i er plan</h2>
      <Link className="card-link" to="/installningar#profil">
        Se abonnemanget →
      </Link>
    </section>
  )
}
