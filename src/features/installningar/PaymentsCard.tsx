import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { ApiError } from '../../shared/api'
import { booqyFaultText, errorText } from '../../shared/errors'
import { createStripeAccountLink, stripeStage } from '../../shared/tenant'
import type { StripeMethodStatus, StripePaymentMethod, StripeStage as Stage, Tenant, TenantStripeStatus } from '../../shared/tenant'
import { ErrorNote } from '../../shared/ErrorNote'
import { Icon } from '../../shared/Icon'
import { TitleInfo } from '../../shared/TitleInfo'
import './payments.css'

/**
 * Betalningar: restaurangens Stripe-konto, från GET /tenant.
 *
 * Plattformen skapar kontot när restaurangen registreras. Ägaren fyller sedan
 * i företags- och bankuppgifter hos Stripe själv (onboarding) - appen ser
 * aldrig de uppgifterna, bara statusen. Stripe meddelar statusändringar till
 * backend (webhook), så efter onboardingen kan det dröja en stund innan
 * statusen nedan ändras.
 */

const POLL_INTERVAL_MS = 3000
const POLL_TRIES = 20

const STAGE_TEXT: Record<Stage, { title: string; text: string; ok: boolean }> = {
  missing: {
    title: 'Inget Stripe-konto än',
    text: 'Kontot skapas av Booqy när restaurangen registreras.',
    ok: false,
  },
  not_started: {
    title: 'Stripe är inte klart',
    text: 'Fyll i företags- och bankuppgifter hos Stripe för att kunna ta emot kortbetalningar.',
    ok: false,
  },
  in_review: {
    title: 'Stripe granskar uppgifterna',
    text: 'Uppgifterna är inskickade. Stripe kan behöva fler uppgifter innan betalningar aktiveras.',
    ok: false,
  },
  ready: {
    title: 'Redo att ta emot betalningar',
    text: '',
    ok: true,
  },
}

/** Där ägaren slår på betalsätt i sitt eget Stripe-konto. */
export const STRIPE_PAYMENT_METHODS_URL = 'https://dashboard.stripe.com/settings/payment_methods'

/** Raderna i Betalsätt; Apple Pay och Google Pay följer kortet. */
const METHOD_ROWS: { label: string; capability: StripePaymentMethod }[] = [
  { label: 'Kort', capability: 'card' },
  { label: 'Apple Pay', capability: 'card' },
  { label: 'Google Pay', capability: 'card' },
  { label: 'Swish', capability: 'swish' },
  { label: 'Klarna', capability: 'klarna' },
]

type MethodState = 'active' | 'pending' | 'off'

const METHOD_STATE: Record<MethodState, { text: string; badge: string }> = {
  active: { text: 'Aktiv', badge: 'reserved' },
  pending: { text: 'Granskas', badge: 'waiting' },
  off: { text: 'Inte aktiverad', badge: 'cancelled-free' },
}

function methodState(status: StripeMethodStatus | undefined): MethodState {
  if (status === 'active') return 'active'
  if (status === 'pending') return 'pending'
  return 'off'
}

/** Betalsätten på kontot, när Stripe är klart och backend skickar dem. */
function PaymentMethods({ methods, isOwner }: {
  methods: NonNullable<TenantStripeStatus['paymentMethods']>
  isOwner: boolean
}) {
  return (
    <div className="pay-methods">
      <TitleInfo
        title="Betalsätt"
        level={3}
        className="pay-methods-title"
        info="Ni slår på betalsätten i ert eget Stripe-konto. Apple Pay och Google Pay följer kort. Stripes avgift skiljer sig mellan betalsätten."
      />
      <ul className="pay-methods-list">
        {METHOD_ROWS.map((row) => {
          const state = methodState(methods[row.capability])
          return (
            <li key={row.label} className="pay-method">
              <span className="pay-method-name">{row.label}</span>
              <span className={`status-badge ${METHOD_STATE[state].badge}`}>{METHOD_STATE[state].text}</span>
              {state === 'off' && isOwner && (
                <a
                  className="pay-method-activate"
                  href={STRIPE_PAYMENT_METHODS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Aktivera i Stripe
                  <Icon name="arrow-right" size={14} />
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function PaymentsCard({
  tenant,
  isOwner,
  stripeReturn,
  onRefresh,
}: {
  tenant: Tenant
  isOwner: boolean
  /** `?stripe=` när Stripe just skickat tillbaka ägaren hit. */
  stripeReturn: string | null
  onRefresh: () => Promise<unknown>
}) {
  const stage = stripeStage(tenant.stripe)
  const info = STAGE_TEXT[stage]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Saknas kontot är det Booqys fel: Försök igen och Rapportera till Booqy.
  const missing = useMemo(() => (stage === 'missing' ? booqyFaultText('Ert Stripe-konto hittas inte.', 'stripe_account_missing') : null), [stage])

  // Tillbaka från Stripe: Stripe meddelar backend via webhook några sekunder
  // efter att formuläret skickats in. Hämta statusen direkt och sedan var
  // tredje sekund i upp till en minut, tills Stripe är klart.
  const [polling, setPolling] = useState(stripeReturn === 'return')
  const isReady = stage === 'ready'
  const refreshAfterReturn = useEffectEvent(() => {
    void onRefresh()
  })
  useEffect(() => {
    if (stripeReturn) refreshAfterReturn()
  }, [stripeReturn])
  useEffect(() => {
    if (!polling || isReady) return
    let tries = 0
    const timer = window.setInterval(() => {
      tries += 1
      refreshAfterReturn()
      if (tries >= POLL_TRIES) {
        window.clearInterval(timer)
        setPolling(false)
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [polling, isReady])

  async function openOnboarding() {
    setError(null)
    setBusy(true)
    try {
      const { url } = await createStripeAccountLink()
      // Länken är en engångslänk som går ut efter några minuter - öppna
      // direkt, i samma flik (Stripe skickar tillbaka hit efteråt).
      window.location.assign(url)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.message === 'no_stripe_account') {
        setError(errorText(err, 'Stripe gick inte att öppna.'))
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Bara restaurangens ägare kan ändra Stripe-kontot. Be ägaren logga in och göra det.')
      } else {
        setError(errorText(err, 'Stripe gick inte att öppna.'))
      }
    }
  }

  const payouts =
    stage === 'ready'
      ? tenant.stripe.payoutsEnabled
        ? 'Kortbetalningar och utbetalningar är aktiva.'
        : 'Kortbetalningar är aktiva. Utbetalningar väntar på bankuppgifter hos Stripe.'
      : info.text

  return (
    <section id="betalningar" className="admin-card table-card">
      <h2 className="card-title">Betalningar</h2>
      <div style={{ height: 16 }} />
      {stripeReturn === 'return' && stage !== 'ready' && (
        <p className="cell-muted" role="status">
          {polling
            ? 'Tillbaka från Stripe. Hämtar den nya statusen…'
            : 'Stripe behandlar uppgifterna.'}
        </p>
      )}
      {stripeReturn === 'refresh' && (
        <p className="cell-muted" role="status">
          Länken hade gått ut. Öppna Stripe igen.
        </p>
      )}
      <div className="stripe-status">
        <span className={`stripe-dot ${info.ok ? 'ok' : ''}`} aria-hidden="true" />
        <div>
          <p className="stripe-title">{info.title}</p>
          <p className="cell-muted">{payouts}</p>
        </div>
      </div>
      {isReady && tenant.stripe.paymentMethods && (
        <PaymentMethods methods={tenant.stripe.paymentMethods} isOwner={isOwner} />
      )}
      {missing && <ErrorNote text={missing} onRetry={() => void onRefresh()} />}
      {error && (
        <ErrorNote text={error} />
      )}
      <div style={{ height: 16 }} />
      {isOwner && stage !== 'missing' && (
        <span className="row-actions">
          {stage !== 'ready' && (
            <button
              type="button"
              className="btn primary square"
              disabled={busy}
              onClick={openOnboarding}
            >
              {busy
                ? 'Öppnar Stripe…'
                : stage === 'not_started'
                  ? 'Slutför Stripe-konfigurationen →'
                  : 'Komplettera uppgifter hos Stripe →'}
            </button>
          )}
          {stage === 'ready' && (
            <a
              className="btn outline square stripe-manage"
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hantera i Stripe →
            </a>
          )}
        </span>
      )}
      {!isOwner && (
        <p className="cell-muted">Bara ägaren hanterar Stripe.</p>
      )}
    </section>
  )
}
