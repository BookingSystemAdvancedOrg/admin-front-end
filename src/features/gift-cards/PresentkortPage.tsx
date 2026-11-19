import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Modal, StatTile, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { useTenant } from '../../shared/tenant'
import { canOpen } from '../../shared/access'
import {
  ERRORS,
  KIND_LABEL,
  STATUS_LABEL,
  endOfStockholmDay,
  extendCard,
  getCard,
  getSettings,
  kr,
  listCards,
  refundCard,
  resendCode,
  saveSettings,
  stockholmDate,
  type CardDetail,
  type Listing,
  type Settings,
} from './api'
import { DateInput } from '../../shared/DateInput'
import { useConfirm } from '../../shared/ConfirmDialog'
import { ErrorNote } from '../../shared/ErrorNote'
import { Loading } from '../../shared/Loading'
import { PlanLocked } from '../../shared/PlanLocked'
import { SkelCard } from '../../shared/Skeleton'
import { SaveBar } from '../../shared/SaveBar'
import { useDirtyForm } from '../../shared/dirtyForm'
import './presentkort.css'

/**
 * Presentkort (planfunktionen "giftCards"): sålda kort, saldo, historik och
 * inställningar. Ägaren, och personal som ägaren gett området; återbetalning
 * och inställningar är bara ägarens.
 */
export default function PresentkortPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.giftCards)
  const allowed = canOpen(tenant, 'presentkort')
  const owner = tenant?.role === 'owner_user'

  return (
    <>
      <AdminTopbar title="Presentkort" />
      <main className="admin-main">
        {!enabled ? <PlanLocked /> : !allowed ? (
          <section className="admin-card table-card">
            <p className="cell-muted">Du har inte behörighet till Presentkort. Be ägaren om behörighet.</p>
          </section>
        ) : <GiftCards owner={owner} />}
      </main>
    </>
  )
}

function GiftCards({ owner }: { owner: boolean }) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setListing(await listCards())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err, 'Presentkorten kunde inte visas.', ERRORS))
    }
  }, [])

  useEffect(() => { void load() }, [load])
  // Levande: kort som säljs eller löses in på en annan plats syns av sig själva.
  useLiveRefresh(async () => setListing(await listCards()))

  const cards = (listing?.cards ?? []).filter((c) => !search.trim() || c.last4.endsWith(search.trim().toUpperCase()))
  return (
    <>
      <div className="presentkort-tiles">
        <StatTile label="Presentkortsskuld" value={listing ? kr(listing.liabilityOre) : '-'} loading={!listing}
          index={0} />
        <StatTile label="Aktiva kort" value={listing ? String(listing.cards.filter((c) => c.status === 'active').length) : '-'}
          loading={!listing} index={1} />
      </div>
      {owner && <SettingsCard />}
      <Card title="Sålda presentkort">
        <Field label="Sök på de fyra sista tecknen">
          <Input value={search} maxLength={4} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {!listing ? (loadError ? <ErrorNote text={loadError} onRetry={() => { setLoadError(null); void load() }} /> : <Loading variant="inline" label="Hämtar presentkorten" />) : null}
        {listing && cards.length === 0 ? <p className="admin-empty">Inga presentkort än.</p> : null}
        {cards.length ? (
          <div className="table-scroll" tabIndex={0}>
            <table className="data-table presentkort-table">
              <thead><tr><th scope="col">Kort</th><th scope="col">Saldo</th><th scope="col">Status</th><th scope="col">Gäller till</th></tr></thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.cardId}>
                    <td><button type="button" className="card-link presentkort-open" onClick={() => setOpenId(c.cardId)}>****{c.last4}</button></td>
                    <td data-label="Saldo"><span className="presentkort-amount">{c.balanceSek.toLocaleString('sv-SE')}</span> av <span className="presentkort-amount">{c.initialSek.toLocaleString('sv-SE')} kr</span></td>
                    <td data-label="Status"><span className="status-badge">{STATUS_LABEL[c.status]}</span></td>
                    <td data-label="Gäller till" className="presentkort-date">{stockholmDate(c.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      {openId ? <CardModal cardId={openId} owner={owner} onClose={() => setOpenId(null)} onChanged={() => void load()} /> : null}
    </>
  )
}

function CardModal({ cardId, owner, onClose, onChanged }: { cardId: string; owner: boolean; onClose: () => void; onChanged: () => void }) {
  const [card, setCard] = useState<CardDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [extendTo, setExtendTo] = useState('')
  const [reason, setReason] = useState('')
  const [confirmResend, setConfirmResend] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmEl, ask] = useConfirm()

  const load = useCallback(async () => {
    try {
      setCard(await getCard(cardId))
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err, 'Presentkortet kunde inte visas.', ERRORS))
    }
  }, [cardId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => setCard(await getCard(cardId)))

  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name)
    try {
      await fn()
      toast(ok, { tone: 'success' })
      await load()
      onChanged()
    } catch (err) {
      toast(errorText(err, 'Ändringen av presentkortet gick inte.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open title={card ? `Presentkort ****${card.last4}` : 'Presentkort'} onClose={onClose} size="wide">
      {confirmEl}
      {!card ? (loadError ? <ErrorNote text={loadError} onRetry={() => { setLoadError(null); void load() }} /> : <Loading variant="inline" label="Hämtar kortet" />) : (
        <>
          <dl className="presentkort-facts">
            <dt>Saldo</dt><dd>{kr(card.balanceOre)} av {card.initialSek.toLocaleString('sv-SE')} kr</dd>
            <dt>Status</dt><dd>{STATUS_LABEL[card.status]}</dd>
            <dt>Gäller till</dt><dd>{stockholmDate(card.expiresAt)}</dd>
            {card.recipientName ? <><dt>Till</dt><dd>{card.recipientName}</dd></> : null}
          </dl>
          <h3 className="presentkort-sub">Historik</h3>
          <ul className="presentkort-history">
            {card.transactions.map((t) => (
              <li key={t.txId}>
                <span>{stockholmDate(t.at)} {KIND_LABEL[t.kind] ?? t.kind}</span>
                <span>{t.amountOre ? kr(t.amountOre) : ''}</span>
              </li>
            ))}
          </ul>
          {card.status === 'active' ? (
            <div className="form-grid">
              <Field label="Förläng till"><DateInput inputClassName="bq-input" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} /></Field>
              <Field label="Anledning" hint="Sparas i historiken." required><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
              <Bar variant="action" label="Presentkortet" className="presentkort-actions">
                <Button variant="secondary" disabled={!extendTo || !reason.trim()} busy={busy === 'extend'}
                  onClick={() => void run('extend', () => extendCard(card.cardId, endOfStockholmDay(extendTo), reason.trim()), 'Giltigheten är förlängd.')}>
                  Förläng
                </Button>
                {confirmResend ? null : (
                  <Button variant="secondary" onClick={() => setConfirmResend(true)}>
                    Skicka ny kod
                  </Button>
                )}
                {owner && <Button variant="danger" disabled={!reason.trim()} busy={busy === 'refund'}
                  onClick={async () => {
                    const ok = await ask({
                      title: `Återbetala ${kr(card.balanceOre)}?`,
                      text: 'Saldot återbetalas till köparen och kortet slutar gälla. Det går inte att ångra.',
                      confirmLabel: 'Återbetala',
                      cancelLabel: 'Behåll kortet',
                      danger: true,
                    })
                    if (ok) await run('refund', () => refundCard(card.cardId, reason.trim()), 'Det som var kvar är återbetalt till köparen.')
                  }}>
                  Återbetala
                </Button>}
              </Bar>
              {confirmResend ? (
                <div className="presentkort-confirm" role="alertdialog" aria-labelledby="presentkort-confirm-text">
                  <p id="presentkort-confirm-text">
                    En ny kod mejlas till {card.recipientEmail ? 'mottagaren' : 'köparen'}. Den gamla koden
                    (****{card.last4}) slutar fungera direkt, även om den redan är utskriven eller vidareskickad.
                  </p>
                  <Bar variant="action" label="Skicka ny kod">
                    <Button variant="ghost" onClick={() => setConfirmResend(false)}>Behåll koden</Button>
                    <Button variant="danger" busy={busy === 'resend'} busyLabel="Skickar…"
                      onClick={() => void run('resend', () => resendCode(card.cardId, card.recipientEmail ? 'recipient' : 'buyer'), 'En ny kod är skickad. Den gamla koden fungerar inte längre.').then(() => setConfirmResend(false))}>
                      Ja, skicka ny kod
                    </Button>
                  </Bar>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Modal>
  )
}

function SettingsCard() {
  const [draft, setDraft] = useState<Settings | null>(null)
  const [amounts, setAmounts] = useState('')
  const [saved, setSaved] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoadError(null)
    getSettings().then((s) => { setDraft(s); setSaved(s); setAmounts(s.amountsSek.join(', ')) })
      .catch((err) => setLoadError(errorText(err, 'Inställningarna för presentkort kunde inte visas.', ERRORS)))
  }, [])

  useEffect(() => { load() }, [load])
  // Spara följer ändringarna (beloppen jämförs som tal: "250,500" = "250, 500").
  const dirty = useDirtyForm(
    draft && { ...draft, amountsSek: amounts.split(/[,\s]+/).filter(Boolean).map(Number) },
    saved,
  )

  if (!draft) {
    return loadError
      ? <Card title="Inställningar"><ErrorNote text={loadError} onRetry={load} /></Card>
      : <SkelCard rows={3} cols={2} aside={false} />
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    setSaving(true)
    setFailed(false)
    setNotice(null)
    try {
      const list = amounts.split(/[,\s]+/).filter(Boolean).map(Number)
      const next = await saveSettings({ ...draft, amountsSek: list })
      setDraft(next)
      setSaved(next)
      setAmounts(next.amountsSek.join(', '))
      setNotice('Sparat')
    } catch (err) {
      setFailed(true)
      toast(errorText(err, 'Inställningarna för presentkort sparades inte.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Inställningar">
      <form className="form-grid" onSubmit={save} aria-label="Presentkortsinställningar">
        <label className="presentkort-check">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
          Sälj presentkort på hemsidan
        </label>
        <Field label="Färdiga belopp (kr)" hint="Till exempel 250, 500, 1000" required>
          <Input value={amounts} onChange={(e) => setAmounts(e.target.value)} />
        </Field>
        <Field label="Eget belopp, lägst (kr)" required>
          <Input type="number" min={100} max={5000} value={String(draft.customMinSek)} onChange={(e) => setDraft({ ...draft, customMinSek: Number(e.target.value) })} />
        </Field>
        <Field label="Eget belopp, högst (kr)" required>
          <Input type="number" min={100} max={5000} value={String(draft.customMaxSek)} onChange={(e) => setDraft({ ...draft, customMaxSek: Number(e.target.value) })} />
        </Field>
        <Field label="Giltighet (månader)" hint="Minst 12" required>
          <Input type="number" min={12} max={60} value={String(draft.validityMonths)} onChange={(e) => setDraft({ ...draft, validityMonths: Number(e.target.value) })} />
        </Field>
        <SaveBar dirty={dirty} busy={saving} notice={notice} failed={failed}
          onDiscard={() => { if (saved) { setDraft(saved); setAmounts(saved.amountsSek.join(', ')) } setFailed(false) }} />
      </form>
    </Card>
  )
}
