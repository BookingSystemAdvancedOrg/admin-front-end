import { useSearchParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'
import { OverviewTab } from './OverviewTab'
import { TemplatesTab } from './TemplatesTab'
import { CampaignsTab } from './CampaignsTab'
import { SubscribersTab } from './SubscribersTab'
import { LinksTab } from './LinksTab'
import { OfferTab } from './OfferTab'
import './marknadsforing.css'

const TABS = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'kampanjer', label: 'Kampanjer' },
  { id: 'mallar', label: 'Mallar' },
  { id: 'erbjudande', label: 'Välkomsterbjudande' },
  { id: 'mottagare', label: 'Mottagare' },
  { id: 'lankar', label: 'Länkar och QR' },
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * Marknadsföring (planfunktionen "marketing", bara ägare).
 *
 *  - Översikt: besök på webbplatsen per kanal och kampanj (utan cookies) och
 *    vad de gav: bokningar, gäster, beställningar och omsättning.
 *  - Kampanjer: välj mall och målgrupp, testa, skicka nu eller schemalägg.
 *  - Mallar: e-postmallar byggda av block, med förhandsvisning.
 *  - Välkomsterbjudande: rabattkupongen på webbplatsen (e-post mot en kod
 *    som gäller en gång), när och hur ofta den visas, och resultatet.
 *  - Mottagare: gäster som sagt ja till erbjudanden (bokning, beställning,
 *    catering eller välkomsterbjudandet).
 *  - Länkar och QR: spårbara länkar för Instagram, affischer och annat.
 *
 * Fliken står i adressen (?flik=), så en länk kan peka direkt på den.
 */
export default function MarknadsforingPage() {
  const { tenant } = useTenant()
  const [params, setParams] = useSearchParams()
  const requested = params.get('flik') as TabId | null
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : 'oversikt'
  const enabled = Boolean(tenant?.entitlements.features.marketing)
  const isOwner = tenant?.role === 'owner_user'

  const select = (id: TabId) => {
    const next = new URLSearchParams(params)
    if (id === 'oversikt') next.delete('flik')
    else next.set('flik', id)
    setParams(next, { replace: true })
  }

  if (!enabled || !isOwner) {
    return (
      <>
        <AdminTopbar title="Marknadsföring" />
        <main className="admin-main">
          <section className="admin-card table-card">
            <h2 className="card-title">{enabled ? 'Bara för ägare' : 'Ingår inte i er plan'}</h2>
            <p className="cell-muted">
              {enabled
                ? 'Marknadsföringen hanteras av restaurangens ägare.'
                : 'Marknadsföring med besöksstatistik och e-postutskick ingår inte i er plan. Kontakta oss för att uppgradera.'}
            </p>
          </section>
        </main>
      </>
    )
  }

  return (
    <>
      <AdminTopbar title="Marknadsföring" />
      <main className="admin-main">
        <nav className="mk-tabs" role="tablist" aria-label="Marknadsföring">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`mk-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`mk-panel-${t.id}`}
              className={tab === t.id ? 'mk-tab active' : 'mk-tab'}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div role="tabpanel" id={`mk-panel-${tab}`} aria-labelledby={`mk-tab-${tab}`} className="mk-panel">
          {tab === 'oversikt' && <OverviewTab onOpen={select} />}
          {tab === 'kampanjer' && <CampaignsTab onOpen={select} />}
          {tab === 'mallar' && <TemplatesTab />}
          {tab === 'erbjudande' && <OfferTab />}
          {tab === 'mottagare' && <SubscribersTab />}
          {tab === 'lankar' && <LinksTab primaryDomain={tenant?.primaryDomain ?? null} />}
        </div>
      </main>
    </>
  )
}

export type { TabId }
