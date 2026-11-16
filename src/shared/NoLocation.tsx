import { Link } from 'react-router-dom'

/** Samma tomläge på alla sidor när restaurangen inte har någon plats än. */
export function NoLocation() {
  return (
    <section className="admin-card table-card tenant-notice">
      <h2 className="card-title">Ingen plats än</h2>
      <Link className="card-link" to="/installningar">
        Till inställningar →
      </Link>
    </section>
  )
}
