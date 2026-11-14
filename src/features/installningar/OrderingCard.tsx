import { ChangedNote } from '../../shared/ChangedNote'
import { dedupe, useLiveForm } from '../../shared/live'
import { errorText } from '../../shared/errors'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useTables } from '../../shared/tables'
import { TableQrModal } from '../table-qr/TableQr'
import { getLocation, updateLocation } from './locationApi'
import type { OrderingPolicy } from './locationApi'
import '../bestallningar/bestallningar.css'

/**
 * Matbeställning för den valda platsen.
 *
 *  - Avhämtning: gästen beställer och betalar på restaurangens webbplats och
 *    får ett sms när maten är klar att hämta.
 *  - Vid bordet: gästen skannar QR-koden på bordet; maten serveras där.
 *
 * Betalning sker alltid online via restaurangens Stripe-konto. Beställning
 * tas bara emot under öppettiderna (avvikande dagar räknas), fram till
 * "sista beställning" före stängning.
 *
 * QR-koderna: en slumpad kod per bord i den publicerade planritningen
 * (Layout). Samma dekal gäller när bordet byter namn eller flyttas; se
 * features/table-qr.
 */

const DEFAULTS: OrderingPolicy = {
  enabled: false,
  pickup: true,
  table: true,
  prepMinutes: 20,
  lastOrderMinutes: 15,
}

interface FormState {
  enabled: boolean
  pickup: boolean
  table: boolean
  prep: string
  last: string
}

function toForm(policy: OrderingPolicy): FormState {
  return {
    enabled: policy.enabled,
    pickup: policy.pickup,
    table: policy.table,
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
  const { tables, error: tablesError } = useTables(locationId)
  const [showQr, setShowQr] = useState(false)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved(loc.ordering ?? null)
        setForm(toForm(loc.ordering ?? DEFAULTS))
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta platsens inställningar.')))
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
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!locationId) return
    setError(null)
    setNotice(null)
    const prep = whole(form.prep, 5, 180)
    const last = whole(form.last, 0, 120)
    if (prep === null) return setError('Tillagningstid: ett heltal 5-180 minuter.')
    if (last === null) return setError('Sista beställning: ett heltal 0-120 minuter före stängning.')
    if (form.enabled && !form.pickup && !form.table) {
      return setError('Välj avhämtning, beställning vid bordet eller båda.')
    }
    const policy: OrderingPolicy = {
      enabled: form.enabled,
      pickup: form.pickup,
      table: form.table,
      prepMinutes: prep,
      lastOrderMinutes: last,
    }
    setBusy(true)
    try {
      const updated = await updateLocation(locationId, { ordering: policy })
      setSaved(updated.ordering ?? policy)
      setNotice(policy.enabled ? 'Sparat. Gästerna kan beställa.' : 'Sparat - beställning är avstängd.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara.', { owner_only: 'Bara restaurangens ägare kan ändra inställningen.', forbidden: 'Bara restaurangens ägare kan ändra inställningen.' }))
    } finally {
      setBusy(false)
    }
  }

  const disabled = !isOwner || busy || loading || !locationId
  const dirty = !loading && JSON.stringify(form) !== JSON.stringify(toForm(saved ?? DEFAULTS))

  return (
    <section id="bestallning" className="admin-card table-card">
      <h2 className="card-title">Beställning</h2>
      {live.there !== null && <ChangedNote onUse={live.takeThere} />}
      <div style={{ height: 8 }} />
      <p className="cell-muted">
        Gästerna beställer och betalar online. Avhämtning: sms när maten är klar. Vid bordet: QR-koden
        på bordet, maten serveras där. Bara under öppettiderna.
      </p>
      {!stripeReady && (
        <p className="form-error" role="status">
          Kräver att restaurangens Stripe-konto är klart (se Betalningar). Tills dess kan gästerna
          inte beställa.
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
                Ta emot beställningar
              </p>
              <p className="cell-muted">Personalen hanterar dem under Beställningar.</p>
            </div>
            <button type="button" role="switch" aria-checked={form.enabled}
              aria-labelledby="ordering-enabled-label" className="switch" disabled={disabled}
              onClick={() => set('enabled', !form.enabled)} />
          </div>
          <div className="toggle-row">
            <p className="toggle-row-label" id="ordering-pickup-label">
              Avhämtning (beställ online, hämta på restaurangen)
            </p>
            <button type="button" role="switch" aria-checked={form.pickup}
              aria-labelledby="ordering-pickup-label" className="switch" disabled={disabled}
              onClick={() => set('pickup', !form.pickup)} />
          </div>
          <div className="toggle-row">
            <p className="toggle-row-label" id="ordering-table-label">
              Beställning vid bordet (QR-kod)
            </p>
            <button type="button" role="switch" aria-checked={form.table}
              aria-labelledby="ordering-table-label" className="switch" disabled={disabled}
              onClick={() => set('table', !form.table)} />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="ordering-prep">Tillagningstid som gästen ser (min)</label>
              <input id="ordering-prep" inputMode="numeric" value={form.prep} disabled={disabled}
                onChange={(e) => set('prep', e.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="ordering-last">Sista beställning (min före stängning)</label>
              <input id="ordering-last" inputMode="numeric" value={form.last} disabled={disabled}
                onChange={(e) => set('last', e.target.value)} />
            </div>
          </div>
          <p className="cell-muted">
            Alkohol kan bara beställas vid bordet (märk drycker med alkohol under Meny). Moms: 6 %
            på avhämtning (t.o.m. 2027), 12 % vid bordet, 25 % på alkohol.
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {isOwner && (
            <span className="row-actions">
              <button type="submit" className="btn primary square" disabled={disabled}>
                {busy ? 'Sparar…' : 'Spara beställning'}
              </button>
              {notice && !dirty && (
                <span className="save-notice" role="status">
                  {notice}
                </span>
              )}
              {dirty && !busy && (
                <span className="form-error" role="status">
                  Ej sparat - klicka Spara beställning.
                </span>
              )}
            </span>
          )}
          {!isOwner && <p className="cell-muted">Bara restaurangens ägare kan ändra inställningen.</p>}
        </form>
      )}

      {locationId && saved?.enabled && saved.table && (
        <div className="qr-section">
          <div style={{ height: 20 }} />
          <h3 className="card-title">QR-koder för borden</h3>
          {tablesError && <p className="form-error" role="alert">Kunde inte hämta borden.</p>}
          {tables && tables.length === 0 && (
            <p className="cell-muted">Publicera en planritning med bord först (Layout).</p>
          )}
          {tables && tables.length > 0 && (
            <>
              <p className="cell-muted">
                En QR-kod per bord. Visas också när du markerar ett bord under Layout.
              </p>
              <span className="row-actions">
                <button type="button" className="btn primary square" onClick={() => setShowQr(true)}>
                  Visa och skriv ut QR-koder ({tables.length} bord)
                </button>
              </span>
            </>
          )}
          {showQr && (
            <TableQrModal
              locationId={locationId}
              mockTables={tables ?? []}
              onClose={() => setShowQr(false)}
            />
          )}
        </div>
      )}
    </section>
  )
}
