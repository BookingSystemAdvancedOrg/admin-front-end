import { useEffect, useEffectEvent, useState } from 'react'
import { ApiError } from '../../shared/api'
import { createStripeAccountLink, stripeStage } from '../../shared/tenant'
import type { StripeStage as Stage, Tenant } from '../../shared/tenant'

/**
 * Betalningar: restaurangens Stripe-konto, från GET /tenant.
 *
 * Plattformen skapar kontot när restaurangen registreras. Ägaren fyller sedan
 * i företags- och bankuppgifter hos Stripe själv (onboarding) — appen ser
 * aldrig de uppgifterna, bara statusen. Stripe meddelar statusändringar till
 * backend (webhook), så efter onboardingen kan det dröja en stund innan
 * statusen nedan ändras.
 */

const POLL_INTERVAL_MS = 3000
const POLL_TRIES = 20

const STAGE_TEXT: Record<Stage, { title: string; text: string; ok: boolean }> = {
  missing: {
    title: 'Inget Stripe-konto än',
    text: 'Kontot skapas av plattformen när restaurangen registreras. Kontakta support om det saknas.',
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
      // Länken är en engångslänk som går ut efter några minuter — öppna
      // direkt, i samma flik (Stripe skickar tillbaka hit efteråt).
      window.location.assign(url)
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiError && err.message === 'no_stripe_account') {
        setError('Restaurangen har inget Stripe-konto än. Kontakta support.')
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Bara restaurangens ägare kan hantera Stripe-kontot.')
      } else {
        setError('Kunde inte öppna Stripe just nu. Försök igen om en stund.')
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
            : 'Tillbaka från Stripe. Stripe behandlar fortfarande uppgifterna — ladda om sidan om en stund.'}
        </p>
      )}
      {stripeReturn === 'refresh' && (
        <p className="cell-muted" role="status">
          Stripe-länken hade gått ut. Öppna Stripe igen för att fortsätta.
        </p>
      )}
      <div className="stripe-status">
        <span className={`stripe-dot ${info.ok ? 'ok' : ''}`} aria-hidden="true" />
        <div>
          <p className="stripe-title">{info.title}</p>
          <p className="cell-muted">{payouts}</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
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
        <p className="cell-muted">Restaurangens ägare hanterar Stripe-kontot.</p>
      )}
    </section>
  )
}
