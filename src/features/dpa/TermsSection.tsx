import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import { ErrorNote } from '../../shared/ErrorNote'
import { errorText } from '../../shared/errors'
import { replaceTenant, useTenant } from '../../shared/tenant'
import { acceptTerms } from './dpaApi'
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_TITLE, TERMS_VERSION } from './termsText'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(d)
}

/**
 * Allmänna villkor för restauranger på sidan Avtal, under
 * personuppgiftsbiträdesavtalet: pris, betalning i förskott, sen betalning
 * och uppsägning. Alla kan läsa; ägaren godkänner (POST /tenant/terms/accept).
 * Godkännandet stänger aldrig webbplatsen.
 */
export function TermsSection() {
  const { tenant, refresh } = useTenant()
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terms = tenant?.terms
  const isOwner = tenant?.role === 'owner_user'
  const upToDate = Boolean(terms?.upToDate)

  async function accept(e: FormEvent) {
    e.preventDefault()
    if (!tenant || !checked) return
    setBusy(true)
    setError(null)
    try {
      replaceTenant(await acceptTerms(tenant))
    } catch (err) {
      const outdated = err instanceof ApiError && err.status === 409
      if (outdated) {
        setChecked(false)
        void refresh()
      }
      setError(
        outdated
          ? 'Villkoren har uppdaterats sedan du öppnade sidan. Läs den nya versionen och godkänn igen.'
          : errorText(err, 'Kunde inte spara.'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <article className="admin-card table-card dpa-text" aria-labelledby="terms-title">
        <h2 id="terms-title" className="card-title">{TERMS_TITLE}</h2>
        <p className="dpa-version">
          Version {TERMS_VERSION}
          {upToDate && terms?.acceptedAt ? `, godkänd ${formatDate(terms.acceptedAt)}` : ''}
        </p>
        <p>{TERMS_INTRO}</p>
        {TERMS_SECTIONS.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            {section.paragraphs.map((p) => <p key={p}>{p}</p>)}
          </section>
        ))}
      </article>
      {terms && !upToDate && (
        <section className="admin-card table-card">
          {isOwner ? (
            <form className="dpa-accept" onSubmit={accept}>
              <label className="dpa-check">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                <span>Jag har läst villkoren och har rätt att godkänna dem för {tenant?.name ?? 'restaurangen'}.</span>
              </label>
              <ErrorNote text={error} />
              <div className="row-actions">
                <button type="submit" className="btn primary square" disabled={!checked || busy}>
                  {busy ? 'Sparar…' : 'Godkänn villkoren'}
                </button>
              </div>
            </form>
          ) : (
            <p className="cell-muted">Bara restaurangens ägare kan godkänna villkoren.</p>
          )}
        </section>
      )}
    </>
  )
}
