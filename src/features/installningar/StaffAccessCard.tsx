import { useState } from 'react'
import type { FormEvent } from 'react'
import { booqyFaultText, errorText } from '../../shared/errors'
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { AreaChecklist } from '../../shared/AreaChecklist'
import { AREAS } from '../../shared/access'
import type { Area } from '../../shared/access'
import { replaceTenant, updateTenant } from '../../shared/tenant'
import type { Tenant } from '../../shared/tenant'

/**
 * Behörigheter (bara ägaren): områdena hela personalen får öppna. En
 * person kan få fler eller färre under Personal. Ägaren har alltid allt.
 */
export function StaffAccessCard({ tenant }: { tenant: Tenant }) {
  const config = tenant.staffAccess
  const saved = config?.defaults ?? []
  const [draft, setDraft] = useState<Area[]>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const order = AREAS.map((a) => a.area)
  const dirty = draft.length !== saved.length || draft.some((a) => !saved.includes(a))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!config) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      replaceTenant(await updateTenant({ staffAccess: { version: config.version, defaults: draft } }))
      setNotice('Sparat.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara behörigheterna.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="behorighet" className="admin-card table-card">
      <TitleInfo
        title="Personalens behörighet"
        info="Det här får all personal öppna. Under Personal ger du en person fler eller färre. Du som ägare har alltid allt."
      />
      <div style={{ height: 16 }} />
      {!config ? (
        <ErrorNote text={booqyFaultText('Kunde inte hämta behörigheterna.')} />
      ) : (
        <form onSubmit={save} className="notifications-form">
          <AreaChecklist
            tenant={tenant}
            idPrefix="group-area"
            checked={(area) => draft.includes(area)}
            disabled={busy}
            onChange={(area, on) => {
              setNotice(null)
              setDraft((d) => order.filter((a) => (a === area ? on : d.includes(a))))
            }}
          />
          {error && <ErrorNote text={error} />}
          <span className="row-actions">
            <button type="submit" className="btn primary square" disabled={busy || !dirty}>
              {busy ? 'Sparar…' : 'Spara'}
            </button>
            {notice && (
              <span className="save-notice" role="status">
                {notice}
              </span>
            )}
          </span>
        </form>
      )}
    </section>
  )
}
