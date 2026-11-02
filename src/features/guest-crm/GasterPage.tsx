import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'

/**
 * Gäster (planfunktionen "guestCrm"). Platshållare från Run 0:
 * sidan finns och är skyddad, funktionen fyller i innehållet.
 */
export default function GasterPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.guestCrm)

  return (
    <>
      <AdminTopbar title="Gäster" />
      <main className="admin-main">
        <section className="admin-card table-card">
          <h2 className="card-title">{enabled ? 'Gäster' : 'Ingår inte i er plan'}</h2>
          <p className="cell-muted">
            {enabled ? 'Den här delen är på väg.' : 'Gästregistret ingår inte i er plan. Kontakta oss för att uppgradera.'}
          </p>
        </section>
      </main>
    </>
  )
}
