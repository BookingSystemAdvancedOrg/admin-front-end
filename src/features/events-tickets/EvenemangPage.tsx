import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'

/**
 * Evenemang (planfunktionen "events", ägare och personal). Platshållare från
 * Run 0-tillägget: sidan, /evenemang/:eventId och insläppet
 * /evenemang/:eventId/inslapp/:occurrenceId finns och är skyddade, funktionen
 * fyller i innehållet.
 */
export default function EvenemangPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.events)

  return (
    <>
      <AdminTopbar title="Evenemang" />
      <main className="admin-main">
        <section className="admin-card table-card">
          <h2 className="card-title">{enabled ? 'Evenemang' : 'Ingår inte i er plan'}</h2>
          <p className="cell-muted">
            {enabled ? 'Den här delen är på väg.' : 'Evenemang och biljetter ingår inte i er plan. Kontakta oss för att uppgradera.'}
          </p>
        </section>
      </main>
    </>
  )
}
