import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'

/**
 * Telefon (planfunktionen "phoneAgent", ägare och personal). Platshållare från
 * Run 0-tillägget: sidan och /telefon/samtal/:callId finns och är skyddade,
 * funktionen fyller i innehållet.
 */
export default function TelefonPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.phoneAgent)

  return (
    <>
      <AdminTopbar title="Telefon" />
      <main className="admin-main">
        <section className="admin-card table-card">
          <h2 className="card-title">{enabled ? 'Telefon' : 'Ingår inte i er plan'}</h2>
          <p className="cell-muted">
            {enabled ? 'Den här delen är på väg.' : 'Telefonassistenten ingår inte i er plan. Kontakta oss för att uppgradera.'}
          </p>
        </section>
      </main>
    </>
  )
}
