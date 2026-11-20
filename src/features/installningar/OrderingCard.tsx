import { ChangedNote } from '../../shared/ChangedNote'
import { dedupe, useLiveForm } from '../../shared/live'
import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { getLocation, updateLocation } from './locationApi'
import type { OrderingPolicy } from './locationApi'
import '../bestallningar/bestallningar.css'
import { ErrorNote } from '../../shared/ErrorNote'
import { TitleInfo } from '../../shared/TitleInfo'
import { SaveBar } from '../../shared/SaveBar'

/**
 * Matbeställning för den valda platsen: bara avhämtning. Gästen beställer och
 * betalar på restaurangens webbplats och får ett sms när maten är klar att hämta.
 *
 * Beställning och betalning vid bordet (QR-kod) togs bort 2026-11-17: betalning
 * på plats ska gå via restaurangens eget kassasystem. `table` skickas inte
 * längre (servern bortser från ett sparat värde) och `pickup` alltid som true,
 * så att "Ta emot beställningar" ensam styr avhämtningen.
 *
 * Betalning sker alltid online via restaurangens Stripe-konto. Beställning
 * tas bara emot under öppettiderna (avvikande dagar räknas), fram till
 * "sista beställning" före stängning.
 */

const DEFAULTS: OrderingPolicy = {
  enabled: false,
  pickup: true,
  prepMinutes: 20,
  lastOrderMinutes: 15,
}

interface FormState {
  enabled: boolean
  prep: string
  last: string
}

function toForm(policy: OrderingPolicy): FormState {
  return {
    // Påslaget utan avhämtning (förr: bara vid bordet) tar inte emot något längre.
    enabled: policy.enabled && policy.pickup !== false,
    prep: String(policy.prepMinutes),
    last: String(policy.lastOrderMinutes),
  }
}

function whole(value: string, low: number, high: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const n = Number(value)
  return n >= low && n <= high ? n : null
}

export function OrderingCard({
  locationId,
  isOwner,
  stripeReady,
}: {
  locationId: string | null
  isOwner: boolean
  stripeReady: boolean
}) {
  const [saved, setSaved] = useState<OrderingPolicy | null>(null)
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULTS))
  const [loading, setLoading] = useState(Boolean(locationId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [invalid, setInvalid] = useState<'prep' | 'last' | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved(loc.ordering ?? null)
        setForm(toForm(loc.ordering ?? DEFAULTS))
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Inställningarna för beställning kunde inte visas.')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [locationId])

  // Levande: sparar en kollega eller en annan plats inställningen syns den av sig själv;
  // har du börjat ändra står ditt kvar med en rad om det andra.
  const live = useLiveForm<OrderingPolicy | null, FormState>({
    enabled: Boolean(locationId) && !loading && !busy,
    fetch: async () => (await dedupe(`location:${locationId}`, () => getLocation(locationId as string))).ordering ?? null,
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
    if (invalid === key) setInvalid(null)
  }

  function discard() {
    setForm(toForm(saved ?? DEFAULTS))
    setError(null)
    setFailed(false)
    setInvalid(null)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId) return
    setError(null)
    setNotice(null)
    setFailed(false)
    setInvalid(null)
    const prep = whole(form.prep, 5, 180)
    const last = whole(form.last, 0, 120)
    if (prep === null || last === null) {
      setError(
        prep === null
          ? 'Tillagningstiden ska vara 5 till 180 minuter. Skriv till exempel 20.'
          : 'Sista beställning ska vara 0 till 120 minuter före stängning. Skriv till exempel 30.',
      )
      setInvalid(prep === null ? 'prep' : 'last')
      setFailed(true)
      return
    }
    const policy: OrderingPolicy = {
      enabled: form.enabled,
      pickup: true,
      prepMinutes: prep,
      lastOrderMinutes: last,
    }
    setBusy(true)
    try {
      const updated = await updateLocation(locationId, { ordering: policy })
      setSaved(updated.ordering ?? policy)
      setNotice(policy.enabled ? 'Sparat. Gästerna kan beställa.' : 'Sparat - beställning är avstängd.')
    } catch (err) {
      setError(errorText(err, 'Inställningarna för beställning sparades inte.', { owner_only: 'Bara restaurangens ägare kan ändra inställningen. Be ägaren göra det.', forbidden: 'Bara restaurangens ägare kan ändra inställningen. Be ägaren göra det.' }))
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const disabled = !isOwner || busy || loading || !locationId
  const dirty = !loading && JSON.stringify(form) !== JSON.stringify(toForm(saved ?? DEFAULTS))

  return (
    <section id="bestallning" className="admin-card table-card">
      <TitleInfo
        title="Beställning"
        info="Gästerna beställer och betalar online och hämtar maten på restaurangen, bara under öppettiderna. Sms när maten är klar. Alkohol kan inte beställas online (märk drycker med alkohol under Meny). Moms: 6 % (t.o.m. 2027). Gäster på plats betalar i restaurangens egen kassa."
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
              <p className="toggle-row-label" id="ordering-enabled-label">
                Ta emot beställningar (avhämtning)
              </p>
            </div>
            <button type="button" role="switch" aria-checked={form.enabled}
              aria-labelledby="ordering-enabled-label" className="switch" disabled={disabled}
              onClick={() => set('enabled', !form.enabled)} />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="ordering-prep">Tillagningstid som gästen ser (min)</label>
              <input id="ordering-prep" inputMode="numeric" value={form.prep} disabled={disabled}
                aria-invalid={invalid === 'prep' || undefined}
                onChange={(e) => set('prep', e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="ordering-last">Sista beställning (min före stängning)</label>
              <input id="ordering-last" inputMode="numeric" value={form.last} disabled={disabled}
                aria-invalid={invalid === 'last' || undefined}
                onChange={(e) => set('last', e.target.value)} />
            </div>
          </div>
          {error && (
            <ErrorNote text={error} />
          )}
          {isOwner && (
            <SaveBar
              dirty={dirty}
              busy={busy}
              label="Spara beställning"
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
