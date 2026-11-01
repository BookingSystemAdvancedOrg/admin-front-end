import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'

/**
 * Webbplats (planfunktionen "siteBuilder", bara ägare). Platshållare från Run 0:
 * sidan finns och är skyddad, funktionen fyller i innehållet.
 */
export default function WebbplatsPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.siteBuilder)
  const allowed = tenant?.role === 'owner_user'
  const blocked = !enabled ? 'Ingår inte i er plan' : !allowed ? 'Bara för ägare' : null

  return (
    <>
      <AdminTopbar title="Webbplats" />
      <main className="admin-main">
        <section className="admin-card table-card">
          <h2 className="card-title">{blocked ?? 'Webbplats'}</h2>
          <p className="cell-muted">
            {!enabled
              ? 'Webbplatsverktyget ingår inte i er plan. Kontakta oss för att uppgradera.'
              : !allowed
                ? 'Webbplatsen hanteras av restaurangens ägare.'
                : 'Den här delen är på väg.'}
          </p>
        </section>
      </main>
    </>
  )
}
