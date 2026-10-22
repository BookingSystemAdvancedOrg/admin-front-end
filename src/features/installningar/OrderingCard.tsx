import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import QRCode from 'qrcode'
import { ApiError } from '../../shared/api'
import { useTables } from '../../shared/tables'
import { tableCodes } from '../bestallningar/ordersApi'
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
 * QR-koderna är signerade av servern (en gäst kan inte hitta på ett bord)
 * och innehåller bordets namn - byter ett bord namn behövs en ny kod.
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

interface QrTile {
  tableId: string
  label: string
  url: string
  image: string
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

function tableTitle(label: string): string {
  return /^bord/i.test(label) ? label : `Bord ${label}`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
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
  const [qr, setQr] = useState<QrTile[] | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    let cancelled = false
    getLocation(locationId)
      .then((loc) => {
        if (cancelled) return
        setSaved(loc.ordering ?? null)
        setForm(toForm(loc.ordering ?? DEFAULTS))
      })
      .catch(() => !cancelled && setError('Kunde inte hämta platsens inställningar.'))
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
      setError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : err instanceof ApiError && err.status === 403
            ? 'Bara restaurangens ägare kan ändra inställningen.'
            : 'Kunde inte spara just nu. Försök igen om en stund.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function makeQrCodes() {
    if (!locationId || !tables?.length) return
    setQrBusy(true)
    setQrError(null)
    try {
      const result = await tableCodes(
        locationId,
        tables.map((t) => ({ tableId: t.tableId, label: t.label })),
      )
      if (result.tables.some((t) => !t.url)) {
        setQrError('Restaurangen har ingen webbadress än - QR-koderna kan inte skapas förrän den finns.')
        return
      }
      const tiles = await Promise.all(
        result.tables.map(async (t) => ({
          tableId: t.tableId,
          label: t.label,
          url: t.url as string,
          image: await QRCode.toDataURL(t.url as string, { margin: 1, width: 480, errorCorrectionLevel: 'M' }),
        })),
      )
      setQr(tiles)
    } catch {
      setQrError('Kunde inte skapa QR-koderna just nu. Försök igen om en stund.')
    } finally {
      setQrBusy(false)
    }
  }

  function printQr() {
    if (!qr) return
    const win = window.open('', '_blank')
    if (!win) return
    const tiles = qr
      .map(
        (t) =>
          `<figure><img src="${t.image}" alt=""><figcaption><strong>${escapeHtml(tableTitle(t.label))}</strong>` +
          `<br>Skanna för att beställa</figcaption></figure>`,
      )
      .join('')
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>QR-koder</title><style>` +
        `body{font-family:system-ui,sans-serif;margin:16px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}` +
        `figure{margin:0;text-align:center;break-inside:avoid;border:1px dashed #bbb;padding:12px}` +
        `img{width:100%;max-width:220px}</style></head><body><main>${tiles}</main></body></html>`,
    )
    win.document.close()
    win.focus()
    win.print()
  }

  const disabled = !isOwner || busy || loading || !locationId
  const dirty = !loading && JSON.stringify(form) !== JSON.stringify(toForm(saved ?? DEFAULTS))

  return (
    <section id="bestallning" className="admin-card table-card">
      <h2 className="card-title">Beställning</h2>
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
              Avhämtning (beställ online, hämta i kassan)
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
          {tablesError && <p className="form-error">Kunde inte hämta borden.</p>}
          {tables && tables.length === 0 && (
            <p className="cell-muted">Publicera en planritning med bord först (Layout).</p>
          )}
          {tables && tables.length > 0 && (
            <span className="row-actions">
              <button type="button" className="btn outline square" disabled={qrBusy}
                onClick={() => void makeQrCodes()}>
                {qrBusy ? 'Skapar…' : `Skapa QR-koder (${tables.length} bord)`}
              </button>
              {qr && (
                <button type="button" className="btn primary square" onClick={printQr}>
                  Skriv ut
                </button>
              )}
            </span>
          )}
          {qrError && (
            <p className="form-error" role="alert">
              {qrError}
            </p>
          )}
          {qr && (
            <div className="qr-sheet">
              {qr.map((t) => (
                <figure key={t.tableId} className="qr-tile">
                  <img src={t.image} alt={`QR-kod för ${tableTitle(t.label)}`} />
                  <figcaption className="qr-tile-label">{tableTitle(t.label)}</figcaption>
                  <a href={t.image} download={`qr-${tableTitle(t.label).replace(/\s+/g, '-').toLowerCase()}.png`}>
                    Ladda ner
                  </a>
                </figure>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
