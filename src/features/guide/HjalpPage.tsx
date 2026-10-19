import { Link } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'
import { useGuide } from './Guide'
import { stepsFor } from './steps'

/**
 * Hjälp: starta introduktionsguiden igen och läs vad varje del av appen gör
 * (samma texter som i guiden).
 */
export default function HjalpPage() {
  const { start } = useGuide()
  const { tenant } = useTenant()
  const sections = stepsFor({
    isOwner: tenant?.role === 'owner_user',
    features: tenant?.entitlements.features ?? {},
  }).filter((s) => s.section)

  return (
    <>
      <AdminTopbar title="Hjälp" subtitle="Kom igång med Booqy Admin" />
      <div className="admin-main">
        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Guiden</h2>
              <p className="cell-muted">En rundtur genom appen, sida för sida. Tar ett par minuter.</p>
            </div>
            <button type="button" className="btn primary square" onClick={start}>
              Starta guiden
            </button>
          </div>
        </section>

        <section className="admin-card table-card">
          <h2 className="card-title">Så fungerar appen</h2>
          <ul className="help-sections">
            {sections.map((s) => (
              <li key={s.id}>
                <strong>{s.section}</strong>
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="admin-card table-card">
          <h2 className="card-title">Cookies och lagring</h2>
          <p className="cell-muted">
            Appen sparar bara det som behövs för att du ska vara inloggad och för dina egna val.{' '}
            <Link className="card-link" to="/cookies">
              Se vad som sparas
            </Link>
          </p>
        </section>
      </div>
    </>
  )
}
