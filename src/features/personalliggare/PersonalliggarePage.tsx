import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'

/**
 * Personalliggare (planfunktionen "personalliggare"). Platshållare från Run 0:
 * sidan finns och är skyddad, funktionen fyller i innehållet.
 */
export default function PersonalliggarePage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.personalliggare)

  return (
    <>
      <AdminTopbar title="Personalliggare (under granskning)" />
      <main className="admin-main">
        <section className="admin-card table-card">
          <h2 className="card-title">{enabled ? 'Personalliggare' : 'Ingår inte i er plan'}</h2>
          <p className="cell-muted">
            {enabled ? 'Den här delen är på väg.' : 'Personalliggare ingår inte i er plan. Kontakta oss för att uppgradera.'}
          </p>
        </section>
      </main>
    </>
  )
}
