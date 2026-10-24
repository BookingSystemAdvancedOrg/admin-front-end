import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { ApiError } from '../../shared/api'
import { replaceTenant, useTenant } from '../../shared/tenant'
import { acceptDpa, dpaBlocksSite } from './dpaApi'
import { DPA_INTRO, DPA_SECTIONS, DPA_TITLE, DPA_VERSION } from './dpaText'
import './dpa.css'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(d)
}

/**
 * /avtal: personuppgiftsbiträdesavtalet mellan restaurangen och Booqy.
 * Alla kan läsa det; bara ägaren kan godkänna. Servern sparar version, tid
 * och vem som godkände (POST /tenant/dpa/accept). En ny restaurang
 * publiceras först när avtalet är godkänt; en restaurang som redan är live
 * påverkas aldrig, den får bara en påminnelse.
 *
 * Efter godkännandet går ägaren vidare till Översikt, där Kom igång visar
 * nästa steg, så att ingen blir stående här med en knapp som försvann.
 */
export default function AvtalPage() {
  const { tenant } = useTenant()
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const dpa = tenant?.dpa
  const isOwner = tenant?.role === 'owner_user'
  const upToDate = Boolean(dpa?.upToDate)

  async function accept(e: FormEvent) {
    e.preventDefault()
    if (!tenant || !checked) return
    setBusy(true)
    setError(null)
    try {
      const updated = await acceptDpa(tenant)
      replaceTenant(updated)
      navigate('/', { state: { dpaAccepted: true, sitePublished: Boolean(updated.dpa?.required) } })
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Avtalet har uppdaterats sedan sidan laddades. Ladda om sidan och läs den nya versionen.'
          : err instanceof ApiError && err.status === 403
            ? 'Bara restaurangens ägare kan godkänna avtalet.'
            : 'Kunde inte spara just nu. Försök igen om en stund.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AdminTopbar title="Avtal" subtitle={DPA_TITLE} />
      <div className="admin-main">
        <section className="admin-card table-card dpa-status" aria-live="polite">
          {upToDate && dpa?.acceptedAt ? (
            <>
              <h2 className="card-title">Avtalet är godkänt</h2>
              <p className="cell-muted">
                Version {dpa.acceptedVersion} godkändes {formatDate(dpa.acceptedAt)}.
              </p>
            </>
          ) : (
            <>
              <h2 className="card-title">
                {dpa?.acceptedVersion ? 'Ny version av avtalet' : 'Avtalet behöver godkännas'}
              </h2>
              <p className="cell-muted">
                {dpaBlocksSite(tenant)
                  ? 'Er webbplats publiceras när restaurangens ägare har godkänt avtalet.'
                  : 'Avtalet beskriver hur Booqy behandlar era gästers personuppgifter för er räkning. Er webbplats påverkas inte.'}
              </p>
            </>
          )}
        </section>

        <article className="admin-card table-card dpa-text" aria-labelledby="dpa-title">
          <h2 id="dpa-title" className="card-title">
            {DPA_TITLE}
          </h2>
          <p className="dpa-version">Version {DPA_VERSION}</p>
          <p>{DPA_INTRO}</p>
          {DPA_SECTIONS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.list ? (
                <ul>
                  {section.paragraphs.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ) : (
                section.paragraphs.map((p) => <p key={p}>{p}</p>)
              )}
            </section>
          ))}
        </article>

        {!upToDate && (
          <section className="admin-card table-card">
            {isOwner ? (
              <form className="dpa-accept" onSubmit={accept}>
                <label className="dpa-check">
                  <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  <span>
                    Jag har läst avtalet och har rätt att godkänna det för {tenant?.name ?? 'restaurangen'}.
                  </span>
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="row-actions">
                  <button type="submit" className="btn primary square" disabled={!checked || busy}>
                    {busy ? 'Sparar…' : 'Godkänn avtalet'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="cell-muted">Bara restaurangens ägare kan godkänna avtalet.</p>
            )}
          </section>
        )}
      </div>
    </>
  )
}
