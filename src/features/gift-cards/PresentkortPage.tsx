import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'

/**
 * Presentkort (planfunktionen "giftCards", bara ägare). Platshållare från Run 0:
 * sidan finns och är skyddad, funktionen fyller i innehållet.
 */
export default function PresentkortPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.giftCards)
  const allowed = tenant?.role === 'owner_user'
  const blocked = !enabled ? 'Ingår inte i er plan' : !allowed ? 'Bara för ägare' : null

  return (
    <>
      <AdminTopbar title="Presentkort" />
      <main className="admin-main">
        <section className="admin-card table-card">
          <h2 className="card-title">{blocked ?? 'Presentkort'}</h2>
          <p className="cell-muted">
            {!enabled
              ? 'Presentkort ingår inte i er plan. Kontakta oss för att uppgradera.'
              : !allowed
                ? 'Presentkorten hanteras av restaurangens ägare.'
                : 'Den här delen är på väg.'}
          </p>
        </section>
      </main>
    </>
  )
}
