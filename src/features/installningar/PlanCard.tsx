import { useEffect, useState } from 'react'
import { ApiError } from '../../shared/api'
import { ErrorNote } from '../../shared/ErrorNote'
import { errorText } from '../../shared/errors'
import { Loading } from '../../shared/Loading'
import type { Tenant } from '../../shared/tenant'
import { type BooqyInvoice, createCardSession, getBooqyBilling } from './billingApi'
import './planCard.css'

const MONTHS = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
]

const PLAN_NAMES: Record<string, string> = { starter: 'Starter', growth: 'Growth' }

/** "2027-02-14" -> "14 februari 2027" (datumet som det står, ingen tidszon). */
export function svDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d || m > 12) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

/** Planens namn: "Gratis till 14 februari 2027", "Gratis", "Starter" ... */
export function planLabel(tenant: Pick<Tenant, 'planId' | 'free'>): string {
  if (tenant.planId === 'free') {
    const until = tenant.free?.until
    return until ? `Gratis till ${svDate(until)}` : 'Gratis'
  }
  if (!tenant.planId) return 'Inget abonnemang'
  return PLAN_NAMES[tenant.planId] ?? tenant.planId.charAt(0).toUpperCase() + tenant.planId.slice(1)
}

/** 1237.5 -> "1 237,50 kr" */
export function svKr(amount: number): string {
  return `${amount.toLocaleString('sv-SE', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })} kr`
}

type PlanTenant = Pick<Tenant, 'planId' | 'free'> & Partial<Pick<Tenant, 'billing' | 'role'>>

/**
 * Restaurangens abonnemang hos Booqy. Planen ändras av Booqy; ägaren lägger
 * till kortet som månadsavgiften dras från (Stripe, Booqys eget konto) och
 * ser öppna fakturor med länk till betalsidan.
 */
export function PlanCard({ tenant }: { tenant: PlanTenant }) {
  const free = tenant.planId === 'free'
  const billing = tenant.billing ?? null
  const isOwner = tenant.role === 'owner_user'
  const cardDone = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('kort') === 'klart'
  return (
    <section className="admin-card table-card plan-card" aria-labelledby="plan-card-title">
      <div className="card-head">
        <div>
          <h2 className="card-title" id="plan-card-title">Abonnemang</h2>
          <p className="plan-card-name">{planLabel(tenant)}</p>
          <p className="cell-muted">{free ? 'Gratis · SMS ingår' : 'SMS ingår · faktureras i förskott den 1:a varje månad'}</p>
        </div>
      </div>
      {isOwner && billing && <PaymentSection billing={billing} cardDone={cardDone} />}
    </section>
  )
}

function PaymentSection({ billing, cardDone }: { billing: NonNullable<Tenant['billing']>; cardDone: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addCard() {
    setBusy(true)
    setError(null)
    try {
      const { url } = await createCardSession()
      window.location.assign(url)
    } catch (err) {
      setBusy(false)
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Booqy har inte startat ert avtal än. Kontakta Booqy så lägger vi upp det.'
          : errorText(err, 'Kunde inte öppna kortsidan.'),
      )
    }
  }

  const cardText = billing.hasCard
    ? `${(billing.cardBrand ?? 'Kort').toUpperCase()} som slutar på ${billing.cardLast4 ?? '****'}`
    : 'Inget kort sparat'
  return (
    <div className="plan-card-pay">
      {cardDone && !billing.hasCard && (
        <p className="plan-card-note" role="status">Kortet är sparat hos Stripe. Det syns här inom en minut.</p>
      )}
      <div className="plan-card-row">
        <div>
          <p className="plan-card-label">Betalning</p>
          <p className="plan-card-value">
            {billing.collection === 'card'
              ? `Dras automatiskt från kortet (${cardText})`
              : billing.preference === 'invoice'
                ? `Faktura med e-post, ${billing.daysUntilDue ?? 30} dagars betalningstid`
                : cardText}
          </p>
        </div>
        {billing.customer && (
          <button type="button" className={`btn square${billing.hasCard ? " outline" : " primary"}`} onClick={addCard} disabled={busy}>
            {busy ? 'Öppnar…' : billing.hasCard ? 'Byt kort' : 'Lägg till kort'}
          </button>
        )}
      </div>
      {!billing.hasCard && billing.preference === 'card' && (
        <p className="plan-card-prompt">
          Lägg till kort så dras månadsavgiften automatiskt. Utan kort skickas fakturan med 10 dagars betalningstid.
        </p>
      )}
      {busy && <Loading variant="inline" label="Öppnar Stripe" />}
      <ErrorNote text={error} onRetry={addCard} />
      {billing.customer && <OpenInvoices />}
    </div>
  )
}

function OpenInvoices() {
  const [invoices, setInvoices] = useState<BooqyInvoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    getBooqyBilling()
      .then((r) => { if (active) setInvoices(r.invoices) })
      .catch((err) => { if (active) setError(errorText(err, 'Kunde inte hämta fakturorna.')) })
    return () => { active = false }
  }, [attempt])

  if (error) return <ErrorNote text={error} onRetry={() => { setError(null); setAttempt((n) => n + 1) }} />
  if (!invoices) return <Loading variant="inline" label="Hämtar fakturor" />
  if (invoices.length === 0) return <p className="cell-muted plan-card-none">Inga obetalda fakturor.</p>
  return (
    <ul className="plan-card-invoices" aria-label="Obetalda fakturor från Booqy">
      {invoices.map((inv, i) => (
        <li key={inv.number ?? i} className={inv.overdue ? 'is-overdue' : undefined}>
          <span className="plan-card-inv-main">
            <strong>{svKr(inv.amountDueSek)}</strong>
            <span className="cell-muted">
              {inv.number ? `Faktura ${inv.number}` : 'Faktura'}
              {inv.dueDate ? ` · ${inv.overdue ? 'förföll' : 'förfaller'} ${svDate(inv.dueDate)}` : ''}
            </span>
          </span>
          {inv.overdue && <span className="plan-card-badge">Försenad</span>}
          {inv.url && (
            <a className="btn square" href={inv.url} target="_blank" rel="noreferrer">Betala</a>
          )}
        </li>
      ))}
    </ul>
  )
}
