import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'
import { useGuide } from './Guide'
import { GUIDE_STEPS } from './steps'

/** Delar som bara finns med vissa planer (samma som i menyn). */
const FEATURE_OF: Record<string, string> = { bestallningar: 'ordering', catering: 'catering' }

/**
 * Hjälp: starta introduktionsguiden igen och läs vad varje del av appen gör
 * (samma texter som i guiden).
 */
export default function HjalpPage() {
  const { start } = useGuide()
  const { tenant } = useTenant()
  const sections = GUIDE_STEPS.filter(
    (s) =>
      s.target?.startsWith('nav-') &&
      s.id !== 'hjalp' &&
      (!FEATURE_OF[s.id] || Boolean(tenant?.entitlements.features[FEATURE_OF[s.id]])),
  )

  return (
    <>
      <AdminTopbar title="Hjälp" subtitle="Kom igång med Booqy Admin" />
      <div className="admin-main">
        <section className="admin-card table-card">
          <div className="card-head">
            <div>
              <h2 className="card-title">Guiden</h2>
              <p className="cell-muted">En kort rundtur som visar var allt finns. Tar ungefär en minut.</p>
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
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
