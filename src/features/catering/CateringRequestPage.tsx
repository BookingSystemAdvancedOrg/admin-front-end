import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { useTenant } from '../../shared/tenant'
import {
  STATUS_LABEL,
  cancelRequest,
  declineRequest,
  errorText,
  formatDate,
  getRequest,
  kronor,
  markDelivered,
  markInvoicePaid,
  offerFromRequest,
  offerTotals,
  saveDraft,
  sendOffer,
  signatureLink,
  statusClass,
} from './cateringApi'
import type { CateringRequest, OfferInput } from './cateringApi'
import { MAX_ITEM_PRICE_KR } from '../meny/menuApi'
import './catering.css'

const EDITABLE = ['requested', 'change_requested', 'offer_sent']

const ACTION_LABEL: Record<string, string> = {
  requested: 'Förfrågan skickad',
  offer_sent: 'Offert skickad',
  change_requested: 'Kunden bad om ändringar',
  rejected: 'Kunden avböjde',
  declined: 'Nekad',
  signing_started: 'Kunden startade BankID',
  signing_failed: 'BankID avbröts',
  signed: 'Signerad med BankID',
  checkout_started: 'Kunden gick till betalning',
  invoiced: 'Faktura skickad',
  invoice_marked_paid: 'Faktura markerad betald',
  delivered: 'Levererad',
  cancelled: 'Avbokad',
  expired: 'Gick ut',
}

/**
 * En cateringförfrågan: vad gästen bad om, offerteditorn (rader, priser,
 * rabatt, leverans, meddelande, giltig till), skicka eller neka, och efter
 * signeringen: signaturen, betalning/faktura, levererad och avbokning.
 */
export default function CateringRequestPage() {
  const { locationId = '', requestId = '' } = useParams()
  const { tenant } = useTenant()
  const isOwner = tenant?.role === 'owner_user'
  const [request, setRequest] = useState<CateringRequest | null>(null)
  const [offer, setOffer] = useState<OfferInput | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'decline' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await getRequest(locationId, requestId)
      setRequest(r)
      setOffer(offerFromRequest(r))
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [locationId, requestId])

  useEffect(() => {
    let active = true
    getRequest(locationId, requestId).then(
      (r) => {
        if (!active) return
        setRequest(r)
        setOffer(offerFromRequest(r))
        setLoadError(null)
      },
      (err: unknown) => {
        if (active) setLoadError(errorText(err))
      },
    )
    return () => {
      active = false
    }
  }, [locationId, requestId])

  async function run(action: () => Promise<CateringRequest | unknown>, done: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setNotice(done)
      setConfirm(null)
      setReason('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      await load()
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <>
        <AdminTopbar title="Catering" />
        <main className="admin-main">
          <p className="form-error" role="alert">{loadError}</p>
          <Link to="/catering">Till alla förfrågningar</Link>
        </main>
      </>
    )
  }
  if (!request || !offer) {
    return (
      <>
        <AdminTopbar title="Catering" />
        <main className="admin-main">
          <p className="cell-muted">Hämtar förfrågan…</p>
        </main>
      </>
    )
  }

  const editable = EDITABLE.includes(request.status) && isOwner
  const totals = offerTotals(offer)
  const nextVersion = (request.currentOfferVersion ?? 0) + 1
  const setLine = (i: number, patch: Partial<OfferInput['lines'][number]>) =>
    setOffer({ ...offer, lines: offer.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) })
  const overPriced = offer.lines.some((l) => l.unitPrice > MAX_ITEM_PRICE_KR)
  const offerValid =
    offer.lines.length > 0 &&
    offer.lines.every((l) => l.name.trim() && l.unitPrice >= 0 && Number.isInteger(l.quantity) && l.quantity >= 1) &&
    !overPriced &&
    totals.total > 0

  return (
    <>
      <AdminTopbar
        title={`Catering · ${request.companyName ?? request.customerName}`}
        subtitle={`${formatDate(request.deliveryDate)} kl ${request.deliveryTime} · ${
          request.fulfilment === 'delivery' ? 'Leverans' : 'Avhämtning'
        }`}
        actions={<Link className="btn outline square" to="/catering">Alla förfrågningar</Link>}
      />
      <main className="admin-main catering-request">
        <div className="settings-row">
          <section className="admin-card table-card">
            <div className="card-head">
              <h2 className="card-title">Kund</h2>
              <span className={`status-badge ${statusClass(request.status)}`}>{STATUS_LABEL[request.status]}</span>
            </div>
            <dl className="catering-facts">
              <div><dt>Namn</dt><dd>{request.customerName}</dd></div>
              {request.companyName && <div><dt>Företag</dt><dd>{request.companyName} ({request.orgNumber})</dd></div>}
              {request.invoiceReference && <div><dt>Referens</dt><dd>{request.invoiceReference}</dd></div>}
              <div><dt>E-post</dt><dd><a href={`mailto:${request.customerEmail}`}>{request.customerEmail}</a></dd></div>
              <div><dt>Telefon</dt><dd><a href={`tel:${request.customerPhone}`}>{request.customerPhone}</a></dd></div>
              {request.deliveryAddress && (
                <div>
                  <dt>Adress</dt>
                  <dd>
                    {request.deliveryAddress.street}, {request.deliveryAddress.postalCode} {request.deliveryAddress.city}
                    {request.deliveryZone === 'beyond' ? ' (utanför området)' : ''}
                  </dd>
                </div>
              )}
              {request.guests && <div><dt>Gäster</dt><dd>{request.guests}</dd></div>}
              {request.notes && <div><dt>Meddelande</dt><dd>{request.notes}</dd></div>}
              {request.capacityLeft !== null && (
                <div><dt>Kapacitet dagen</dt><dd>{request.capacityLeft} portioner kvar</dd></div>
              )}
            </dl>
          </section>

          <section className="admin-card table-card">
            <h2 className="card-title">Kundens kalkyl</h2>
            <ul className="catering-lines">
              {request.request.lines.map((l) => (
                <li key={l.name}>
                  <span>{l.quantity} × {l.name}</span>
                  <span>{kronor(l.unitPrice * l.quantity)}</span>
                </li>
              ))}
              {request.request.discount > 0 && (
                <li><span>Rabatt {request.request.discountPercent} %{request.request.tierName ? ` (${request.request.tierName})` : ''}</span>
                  <span>-{kronor(request.request.discount)}</span></li>
              )}
              {request.request.deliveryFee > 0 && <li><span>Leverans</span><span>{kronor(request.request.deliveryFee)}</span></li>}
              <li className="catering-lines-total"><span>Totalt inkl. moms</span><span>{kronor(request.request.total)}</span></li>
            </ul>
          </section>
        </div>

        {request.status === 'change_requested' && request.changeMessage && (
          <p className="catering-callout" role="status">
            <strong>Kunden vill ändra offerten:</strong> ”{request.changeMessage}”
          </p>
        )}
        {request.status === 'rejected' && (
          <p className="catering-callout">Kunden avböjde offerten{request.rejectReason ? `: ”${request.rejectReason}”` : '.'}</p>
        )}

        {editable && (
          <section className="admin-card table-card">
            <div className="card-head">
              <div>
                <h2 className="card-title">
                  {request.status === 'requested' ? 'Offert' : `Ny offertversion (v${nextVersion})`}
                </h2>
                <p className="cell-muted">
                  Justera fritt - priser i kronor inkl. moms. Kunden signerar exakt den version du skickar.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table offer-table">
                <thead>
                  <tr><th>Rad</th><th>Á-pris (kr)</th><th>Antal</th><th>Summa</th><th /></tr>
                </thead>
                <tbody>
                  {offer.lines.map((l, i) => (
                    <tr key={i}>
                      <td><input aria-label={`Rad ${i + 1} namn`} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                      <td><input aria-label={`Rad ${i + 1} pris`} inputMode="decimal" value={String(l.unitPrice)}
                        onChange={(e) => setLine(i, { unitPrice: Number(e.target.value.replace(',', '.')) || 0 })} /></td>
                      <td><input aria-label={`Rad ${i + 1} antal`} inputMode="numeric" value={String(l.quantity)}
                        onChange={(e) => setLine(i, { quantity: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></td>
                      <td>{kronor(Math.round(l.unitPrice * 100) * l.quantity)}</td>
                      <td>
                        <button type="button" className="link-action danger" aria-label={`Ta bort rad ${i + 1}`}
                          onClick={() => setOffer({ ...offer, lines: offer.lines.filter((_, n) => n !== i) })}>Ta bort</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="link-action"
              onClick={() => setOffer({ ...offer, lines: [...offer.lines, { name: '', unitPrice: 0, quantity: 1 }] })}>
              + Lägg till rad (t.ex. personal, dukning)
            </button>
            <div style={{ height: 12 }} />
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="offer-discount">Rabatt (%)</label>
                <input id="offer-discount" inputMode="numeric" value={String(offer.discountPercent)}
                  onChange={(e) => setOffer({ ...offer, discountPercent: Math.min(50, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
              </div>
              <div className="form-field">
                <label htmlFor="offer-delivery">Leverans (kr)</label>
                <input id="offer-delivery" inputMode="decimal" value={String(offer.deliveryFee)}
                  onChange={(e) => setOffer({ ...offer, deliveryFee: Number(e.target.value.replace(',', '.')) || 0 })} />
              </div>
              <div className="form-field">
                <label htmlFor="offer-valid">Giltig till och med</label>
                <input id="offer-valid" type="date" value={offer.validUntil ?? ''} max={request.deliveryDate}
                  onChange={(e) => setOffer({ ...offer, validUntil: e.target.value || undefined })} />
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="offer-message">Meddelande till kunden</label>
              <textarea id="offer-message" rows={3} maxLength={1000} value={offer.message}
                onChange={(e) => setOffer({ ...offer, message: e.target.value })} />
            </div>
            <ul className="catering-lines">
              <li><span>Delsumma</span><span>{kronor(totals.subtotal)}</span></li>
              {totals.discount > 0 && <li><span>Rabatt {totals.discountPercent} %</span><span>-{kronor(totals.discount)}</span></li>}
              {totals.deliveryFee > 0 && <li><span>Leverans</span><span>{kronor(totals.deliveryFee)}</span></li>}
              <li className="catering-lines-total"><span>Totalt inkl. moms</span><span>{kronor(totals.total)}</span></li>
              <li className="cell-muted"><span>varav moms 12 %</span><span>{kronor(totals.vat)}</span></li>
            </ul>
            {overPriced && (
              <p className="form-error" role="alert">
                Pris per rad får vara högst {MAX_ITEM_PRICE_KR.toLocaleString('sv-SE')} kr.
              </p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="save-notice" role="status">{notice}</p>}
            <span className="row-actions">
              <button type="button" className="btn primary square" disabled={busy || !offerValid}
                onClick={() => void run(() => sendOffer(locationId, requestId, offer), 'Offerten är skickad till kunden (mejl + sms).')}>
                {busy ? 'Skickar…' : `Skicka offert${request.currentOfferVersion ? ` v${nextVersion}` : ''}`}
              </button>
              <button type="button" className="btn outline square" disabled={busy || !offerValid}
                onClick={() => void run(() => saveDraft(locationId, requestId, offer), 'Utkastet är sparat.')}>
                Spara utkast
              </button>
              {confirm !== 'decline' ? (
                <button type="button" className="btn danger-outline square" disabled={busy} onClick={() => setConfirm('decline')}>
                  Neka förfrågan
                </button>
              ) : null}
            </span>
            {confirm === 'decline' && (
              <div className="catering-confirm" role="group" aria-label="Neka förfrågan">
                <label htmlFor="decline-reason">Meddelande till kunden (valfritt)</label>
                <textarea id="decline-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <span className="row-actions">
                  <button type="button" className="btn danger-outline square" disabled={busy}
                    onClick={() => void run(() => declineRequest(locationId, requestId, reason), 'Förfrågan är nekad.')}>
                    Bekräfta: neka
                  </button>
                  <button type="button" className="btn outline square" onClick={() => setConfirm(null)}>Avbryt</button>
                </span>
              </div>
            )}
          </section>
        )}

        {request.offers.length > 0 && (
          <section className="admin-card table-card">
            <h2 className="card-title">Skickade offerter</h2>
            <ul className="catering-versions">
              {[...request.offers].reverse().map((o) => (
                <li key={o.version}>
                  <strong>v{o.version}</strong> · {kronor(o.totals.total)} · giltig t.o.m. {o.validUntil}
                  {o.createdAt ? ` · skickad ${o.createdAt.slice(0, 16).replace('T', ' ')}` : ''}
                  {request.signature && request.offer?.version === o.version && request.status !== 'offer_sent'
                    ? ' · signerad' : ''}
                </li>
              ))}
            </ul>
          </section>
        )}

        {request.signature && (
          <section className="admin-card table-card">
            <h2 className="card-title">Signerad med BankID</h2>
            <dl className="catering-facts">
              <div><dt>Signerad av</dt><dd>{request.signature.name} ({request.signature.personalNumberMasked})</dd></div>
              <div><dt>Tid</dt><dd>{request.signature.signedAt.replace('T', ' ').slice(0, 16)}</dd></div>
              <div><dt>Dokument-ID</dt><dd className="mono">{request.signature.documentHash}</dd></div>
              <div>
                <dt>Betalning</dt>
                <dd>
                  {request.customerType === 'company'
                    ? request.stripeInvoiceId
                      ? <>Faktura {request.invoiceNumber} · {request.invoiceStatus === 'paid' || request.paid ? 'betald' : request.invoiceStatus ?? 'skickad'}
                          {request.invoiceUrl && <> · <a href={request.invoiceUrl} target="_blank" rel="noreferrer">Visa faktura</a></>}</>
                      : 'Fakturan skapas…'
                    : request.paid ? 'Betald online' : 'Väntar på kundens betalning'}
                </dd>
              </div>
            </dl>
            <span className="row-actions">
              <button type="button" className="btn outline square"
                onClick={() => void signatureLink(locationId, requestId).then((l) => window.open(l.url, '_blank'))}>
                Ladda ner signaturbevis
              </button>
              {isOwner && request.stripeInvoiceId && !request.paid && request.status !== 'cancelled' && (
                <button type="button" className="btn outline square" disabled={busy}
                  onClick={() => void run(() => markInvoicePaid(locationId, request.stripeInvoiceId!), 'Fakturan markeras som betald.')}>
                  Markera faktura betald (Bankgiro)
                </button>
              )}
              {request.status === 'confirmed' && (
                <button type="button" className="btn primary square" disabled={busy}
                  onClick={() => void run(() => markDelivered(locationId, requestId), 'Markerad som levererad.')}>
                  Markera levererad
                </button>
              )}
              {isOwner && ['signed', 'confirmed', 'delivered'].includes(request.status) && confirm !== 'cancel' && (
                <button type="button" className="btn danger-outline square" disabled={busy} onClick={() => setConfirm('cancel')}>
                  Avboka
                </button>
              )}
            </span>
            {confirm === 'cancel' && (
              <div className="catering-confirm" role="group" aria-label="Avboka">
                <p>
                  Avbokning (sjukdom, force majeure): betald onlinebetalning återbetalas, en obetald faktura
                  makuleras. Kunden får besked via mejl och sms.
                </p>
                <label htmlFor="cancel-reason">Anledning (visas för kunden)</label>
                <textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                <span className="row-actions">
                  <button type="button" className="btn danger-outline square" disabled={busy || !reason.trim()}
                    onClick={() => void run(() => cancelRequest(locationId, requestId, reason), 'Beställningen är avbokad.')}>
                    Bekräfta avbokning
                  </button>
                  <button type="button" className="btn outline square" onClick={() => setConfirm(null)}>Behåll</button>
                </span>
              </div>
            )}
            {request.refundNote === 'refund_manually' && (
              <p className="form-error">Fakturan var betald via Bankgiro - betala tillbaka till kunden manuellt.</p>
            )}
            {!editable && error && <p className="form-error" role="alert">{error}</p>}
            {!editable && notice && <p className="save-notice" role="status">{notice}</p>}
          </section>
        )}

        <section className="admin-card table-card">
          <h2 className="card-title">Händelser</h2>
          <ul className="catering-history">
            {request.history.map((h, i) => (
              <li key={i}>
                <span className="cell-muted">{h.at.replace('T', ' ').slice(0, 16)}</span>{' '}
                {ACTION_LABEL[h.action] ?? h.action}
                {typeof h.version === 'number' ? ` (v${h.version})` : ''}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  )
}
