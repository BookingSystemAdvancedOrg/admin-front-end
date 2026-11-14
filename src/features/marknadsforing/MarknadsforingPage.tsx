import { useSearchParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'
import { Slot, slotVisible } from '../../shared/slots'
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

/** Flikar från planfunktionerna (CONTRACTS.md 8.2), var och en bara när den ingår. */
const SLOT_TABS = [
  { id: 'annonser', label: 'Annonser', slot: 'marketing.tab.annonser' },
  { id: 'omdomen', label: 'Omdömen', slot: 'marketing.tab.omdomen' },
  { id: 'inlagg', label: 'Inlägg', slot: 'marketing.tab.inlagg' },
] as const

type TabId = (typeof TABS)[number]['id'] | (typeof SLOT_TABS)[number]['id']

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
  const marketing = Boolean(tenant?.entitlements?.features?.marketing)
  // De sex vanliga flikarna kräver "marketing"; de övriga sin egen funktion.
  const tabs: { id: TabId; label: string }[] = [
    ...(marketing ? TABS : []),
    ...SLOT_TABS.filter((t) => slotVisible(tenant, t.slot)),
  ]
  const requested = params.get('flik') as TabId | null
  const fallback: TabId = tabs[0]?.id ?? 'oversikt'
  const tab: TabId = tabs.some((t) => t.id === requested) ? (requested as TabId) : fallback
  // Samma "någon av" som menyn (AdminLayout): sidan finns när minst en ingår.
  const enabled = (['marketing', 'metaAds', 'googleBusiness', 'socialPosting'] as const).some((k) =>
    Boolean(tenant?.entitlements?.features?.[k]),
  )
  const isOwner = tenant?.role === 'owner_user'

  const select = (id: TabId) => {
    const next = new URLSearchParams(params)
    if (id === fallback) next.delete('flik')
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
                : 'Kontakta oss för att uppgradera.'}
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
          {tabs.map((t) => (
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
          {/* Överst i Mottagare; ligger här eftersom SubscribersTab inte läser restaurangen själv. */}
          {tab === 'mottagare' && <Slot id="marketing.mottagare.segments" props={{}} />}
          {tab === 'mottagare' && <SubscribersTab />}
          {tab === 'lankar' && <LinksTab primaryDomain={tenant?.primaryDomain ?? null} />}
          {SLOT_TABS.map((t) => tab === t.id && <Slot key={t.id} id={t.slot} props={{}} />)}
        </div>
      </main>
    </>
  )
}

export type { TabId }
