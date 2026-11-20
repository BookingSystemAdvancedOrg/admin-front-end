import { ChangedNote } from '../../shared/ChangedNote'
import { dedupe, useLiveForm } from '../../shared/live'
import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getLocation, updateLocation } from './locationApi'
import type { GuaranteePolicy } from './locationApi'
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { SaveBar } from '../../shared/SaveBar'

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
  const [failed, setFailed] = useState(false)
  const [invalid, setInvalid] = useState<(keyof FormState)[]>([])

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved(loc.guarantee ?? null)
        setForm(toForm(loc.guarantee ?? DEFAULTS))
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Avbokningspolicyn kunde inte visas.')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Levande: sparar en kollega eller en annan plats inställningen syns den av sig själv;
  // har du börjat ändra står ditt kvar med en rad om det andra.
  const live = useLiveForm<GuaranteePolicy | null, FormState>({
    enabled: Boolean(locationId) && !loading && !busy,
    fetch: async () => (await dedupe(`location:${locationId}`, () => getLocation(locationId as string))).guarantee ?? null,
    saved,
    form,
    toForm: (s) => toForm(s ?? DEFAULTS),
    adopt: (s) => {
      setSaved(s)
      setForm(toForm(s ?? DEFAULTS))
    },
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
    setFailed(false)
    setInvalid((list) => list.filter((k) => k !== key))
  }

  function discard() {
    setForm(toForm(saved ?? DEFAULTS))
    setError(null)
    setFailed(false)
    setInvalid([])
  }

  function refuse(text: string, fields: (keyof FormState)[]) {
    setError(text)
    setInvalid(fields)
    setFailed(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId) return
    setError(null)
    setNotice(null)
    setFailed(false)
    setInvalid([])
    const minPartySize = whole(form.minPartySize, 1, 50)
    const noShow = whole(form.noShow, 0, 5000)
    const lateCancel = whole(form.lateCancel, 0, 5000)
    const cutoff = whole(form.cutoff, 0, 168)
    if (minPartySize === null) return refuse('Sällskapets storlek ska vara 1 till 50 personer. Skriv till exempel 8.', ['minPartySize'])
    if (noShow === null || lateCancel === null) {
      return refuse('Avgiften ska vara 0 till 5 000 kr per person. Skriv till exempel 200.', [
        ...(noShow === null ? ['noShow' as const] : []),
        ...(lateCancel === null ? ['lateCancel' as const] : []),
      ])
    }
    if (cutoff === null) return refuse('Avbokningsgränsen ska vara 0 till 168 timmar. Skriv till exempel 24.', ['cutoff'])
    if (form.enabled && noShow === 0 && lateCancel === 0) {
      return refuse('Fyll i minst en avgift: no-show eller sen avbokning.', ['noShow', 'lateCancel'])
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
      setError(errorText(err, 'Avbokningspolicyn sparades inte.', { owner_only: 'Bara restaurangens ägare kan ändra policyn. Be ägaren göra det.', forbidden: 'Bara restaurangens ägare kan ändra policyn. Be ägaren göra det.' }))
      setFailed(true)
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
      <TitleInfo
        title="Avbokningspolicy"
        info="Med kortgaranti sparar gästen sitt kort när hen bokar online (3-D Secure), inget dras då. Uteblir gästen eller avbokar för sent kan avgiften debiteras. Beloppen låses på bokningen."
      />
      {live.there !== null && <ChangedNote onUse={live.takeThere} />}
      <div style={{ height: 8 }} />
      {!stripeReady && (
        <p className="form-error" role="status">
          Kräver Stripe (se Betalningar).
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
                aria-invalid={invalid.includes('minPartySize') || undefined}
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
                aria-invalid={invalid.includes('cutoff') || undefined}
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
                aria-invalid={invalid.includes('noShow') || undefined}
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
                aria-invalid={invalid.includes('lateCancel') || undefined}
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
              Nu: avstängd.
            </p>
          )}
          {error && (
            <ErrorNote text={error} />
          )}
          {isOwner && (
            <SaveBar
              dirty={dirty}
              busy={busy}
              label="Spara policy"
              notice={notice}
              failed={failed}
              disabled={disabled}
              onDiscard={discard}
            />
          )}
          {!isOwner && <p className="cell-muted">Bara ägaren kan ändra.</p>}
        </form>
      )}
    </section>
  )
}
