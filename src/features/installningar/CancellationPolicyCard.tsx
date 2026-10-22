import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import { getLocation, updateLocation } from './locationApi'
import type { GuaranteePolicy } from './locationApi'

/**
 * Avbokningspolicy / kortgaranti för den valda platsen.
 *
 * När den är på sparar gästen sitt kort vid onlinebokning (inget dras då).
 * Uteblir gästen kan personalen debitera no-show-avgiften; avbokar gästen
 * senare än gränsen dras avgiften för sen avbokning. Beloppen gäller per
 * person och låses på bokningen när gästen bokar - ändringar här påverkar
 * bara nya bokningar. Kräver att restaurangens Stripe-konto kan ta emot
 * betalningar.
 */

const DEFAULTS: GuaranteePolicy = {
  enabled: false,
  minPartySize: 1,
  noShowFeePerPerson: 250,
  lateCancelFeePerPerson: 0,
  cancelCutoffHours: 24,
}

interface FormState {
  enabled: boolean
  minPartySize: string
  noShow: string
  lateCancel: string
  cutoff: string
}

function toForm(policy: GuaranteePolicy): FormState {
  return {
    enabled: policy.enabled,
    minPartySize: String(policy.minPartySize),
    noShow: String(policy.noShowFeePerPerson),
    lateCancel: String(policy.lateCancelFeePerPerson),
    cutoff: String(policy.cancelCutoffHours),
  }
}

function whole(value: string, low: number, high: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const n = Number(value)
  return n >= low && n <= high ? n : null
}

export function CancellationPolicyCard({
  locationId,
  isOwner,
  stripeReady,
}: {
  locationId: string | null
  isOwner: boolean
  stripeReady: boolean
}) {
  const [saved, setSaved] = useState<GuaranteePolicy | null>(null)
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULTS))
  const [loading, setLoading] = useState(Boolean(locationId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved(loc.guarantee ?? null)
        setForm(toForm(loc.guarantee ?? DEFAULTS))
      })
      .catch(() => !cancelled && setError('Kunde inte hämta platsens policy.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [locationId])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId) return
    setError(null)
    setNotice(null)
    const minPartySize = whole(form.minPartySize, 1, 50)
    const noShow = whole(form.noShow, 0, 5000)
    const lateCancel = whole(form.lateCancel, 0, 5000)
    const cutoff = whole(form.cutoff, 0, 168)
    if (minPartySize === null) return setError('Sällskapsstorlek: ett heltal 1-50.')
    if (noShow === null || lateCancel === null) {
      return setError('Avgifterna: heltal 0-5000 kr per person.')
    }
    if (cutoff === null) return setError('Avbokningsgränsen: ett heltal 0-168 timmar.')
    if (form.enabled && noShow === 0 && lateCancel === 0) {
      return setError('Ange en no-show-avgift eller en avgift för sen avbokning.')
    }
    const policy: GuaranteePolicy = {
      enabled: form.enabled,
      minPartySize,
      noShowFeePerPerson: noShow,
      lateCancelFeePerPerson: lateCancel,
      cancelCutoffHours: cutoff,
    }
    setBusy(true)
    try {
      const updated = await updateLocation(locationId, { guarantee: policy })
      setSaved(updated.guarantee ?? policy)
      setNotice(policy.enabled ? 'Sparat. Gäller nya bokningar.' : 'Sparat - kortgarantin är avstängd.')
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : err instanceof ApiError && err.status === 403
            ? 'Bara restaurangens ägare kan ändra policyn.'
            : 'Kunde inte spara just nu. Försök igen om en stund.',
      )
    } finally {
      setBusy(false)
    }
  }

  const disabled = !isOwner || busy || loading || !locationId
  // Kortet sparas för sig (inte med sidans "Spara ändringar") - visa tydligt
  // när formuläret skiljer sig från det som faktiskt gäller.
  const dirty =
    !loading &&
    JSON.stringify(form) !== JSON.stringify(toForm(saved ?? DEFAULTS))

  return (
    <section id="avbokningspolicy" className="admin-card table-card">
      <h2 className="card-title">Avbokningspolicy</h2>
      <div style={{ height: 8 }} />
      <p className="cell-muted">
        Med kortgaranti sparar gästen sitt kort när hen bokar online - inget dras då. Uteblir
        gästen eller avbokar för sent kan avgiften debiteras. Beloppen låses på bokningen.
      </p>
      {!stripeReady && (
        <p className="form-error" role="status">
          Kräver att restaurangens Stripe-konto är klart (se Betalningar). Tills dess bokar
          gästerna utan kort.
        </p>
      )}
      <div style={{ height: 16 }} />
      {!locationId ? (
        <p className="cell-muted">Välj en plats först.</p>
      ) : (
        <form onSubmit={save} className="notifications-form">
          <div className="toggle-row">
            <div>
              <p className="toggle-row-label" id="guarantee-enabled-label">
                Kortgaranti vid onlinebokning
              </p>
              <p className="cell-muted">Gästen lägger in kort i bokningen (3-D Secure).</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              aria-labelledby="guarantee-enabled-label"
              className="switch"
              disabled={disabled}
              onClick={() => set('enabled', !form.enabled)}
            />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="guarantee-min">Kort krävs från (antal personer)</label>
              <input
                id="guarantee-min"
                inputMode="numeric"
                value={form.minPartySize}
                disabled={disabled}
                onChange={(e) => set('minPartySize', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="guarantee-cutoff">Sen avbokning: senare än (timmar före)</label>
              <input
                id="guarantee-cutoff"
                inputMode="numeric"
                value={form.cutoff}
                disabled={disabled}
                onChange={(e) => set('cutoff', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="guarantee-noshow">No-show-avgift (kr per person)</label>
              <input
                id="guarantee-noshow"
                inputMode="numeric"
                value={form.noShow}
                disabled={disabled}
                onChange={(e) => set('noShow', e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="guarantee-late">Avgift sen avbokning (kr per person)</label>
              <input
                id="guarantee-late"
                inputMode="numeric"
                value={form.lateCancel}
                disabled={disabled}
                onChange={(e) => set('lateCancel', e.target.value)}
              />
            </div>
          </div>
          {saved?.enabled ? (
            <p className="cell-muted">
              Nu: kort från {saved.minPartySize} pers · no-show {saved.noShowFeePerPerson} kr/pers ·
              sen avbokning {saved.lateCancelFeePerPerson} kr/pers inom {saved.cancelCutoffHours} h.
            </p>
          ) : (
            <p className="cell-muted">
              Nu: kortgaranti är avstängd - gästerna bokar utan kort. Slå på reglaget ovan och spara.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {isOwner && (
            <span className="row-actions">
              <button type="submit" className="btn primary square" disabled={disabled}>
                {busy ? 'Sparar…' : 'Spara policy'}
              </button>
              {notice && !dirty && (
                <span className="save-notice" role="status">
                  {notice}
                </span>
              )}
              {dirty && !busy && (
                <span className="form-error" role="status">
                  Ej sparat - klicka Spara policy.
                </span>
              )}
            </span>
          )}
          {!isOwner && <p className="cell-muted">Bara restaurangens ägare kan ändra policyn.</p>}
        </form>
      )}
    </section>
  )
}
