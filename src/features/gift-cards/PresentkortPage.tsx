import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Modal, StatTile, toast } from '@booqy/brand'
import { AdminTopbar } from '../../shared/AdminTopbar'
import { errorText } from '../../shared/errors'
import { useTenant } from '../../shared/tenant'
import {
  ERRORS,
  KIND_LABEL,
  STATUS_LABEL,
  extendCard,
  getCard,
  getSettings,
  kr,
  listCards,
  refundCard,
  resendCode,
  saveSettings,
  type CardDetail,
  type Listing,
  type Settings,
} from './api'
import './presentkort.css'

/** Presentkort (planfunktionen "giftCards", bara ägare): sålda kort, saldo, historik och inställningar. */
export default function PresentkortPage() {
  const { tenant } = useTenant()
  const enabled = Boolean(tenant?.entitlements?.features?.giftCards)
  const allowed = tenant?.role === 'owner_user'
  const blocked = !enabled ? 'Ingår inte i er plan' : !allowed ? 'Bara för ägare' : null

  return (
    <>
      <AdminTopbar title="Presentkort" />
      <main className="admin-main">
        {blocked ? (
          <section className="admin-card table-card">
            <h2 className="card-title">{blocked}</h2>
            <p className="cell-muted">
              {!enabled ? 'Presentkort ingår inte i er plan. Kontakta oss för att uppgradera.'
                : 'Presentkorten hanteras av restaurangens ägare.'}
            </p>
          </section>
        ) : <GiftCards />}
      </main>
    </>
  )
}

function GiftCards() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setListing(await listCards())
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta presentkorten.', ERRORS), { tone: 'danger' })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const cards = (listing?.cards ?? []).filter((c) => !search.trim() || c.last4.endsWith(search.trim().toUpperCase()))
  return (
    <>
      <div className="presentkort-tiles">
        <StatTile label="Presentkortsskuld" value={listing ? kr(listing.liabilityOre) : '-'} loading={!listing}
          note="Summan av saldot på alla aktiva kort." index={0} />
        <StatTile label="Aktiva kort" value={listing ? String(listing.cards.filter((c) => c.status === 'active').length) : '-'}
          loading={!listing} index={1} />
      </div>
      <SettingsCard />
      <Card title="Sålda presentkort">
        <Field label="Sök på de fyra sista tecknen">
          <Input value={search} maxLength={4} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {listing && cards.length === 0 ? <p className="admin-empty">Inga presentkort än.</p> : null}
        {cards.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th scope="col">Kort</th><th scope="col">Saldo</th><th scope="col">Status</th><th scope="col">Gäller till</th></tr></thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.cardId}>
                    <td><button type="button" className="card-link presentkort-open" onClick={() => setOpenId(c.cardId)}>****{c.last4}</button></td>
                    <td>{c.balanceSek.toLocaleString('sv-SE')} av {c.initialSek.toLocaleString('sv-SE')} kr</td>
                    <td><span className="status-badge">{STATUS_LABEL[c.status]}</span></td>
                    <td>{c.expiresAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      {openId ? <CardModal cardId={openId} onClose={() => setOpenId(null)} onChanged={() => void load()} /> : null}
    </>
  )
}

function CardModal({ cardId, onClose, onChanged }: { cardId: string; onClose: () => void; onChanged: () => void }) {
  const [card, setCard] = useState<CardDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [extendTo, setExtendTo] = useState('')
  const [reason, setReason] = useState('')
  const [confirmResend, setConfirmResend] = useState(false)

  const load = useCallback(async () => {
    try {
      setCard(await getCard(cardId))
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta kortet.', ERRORS), { tone: 'danger' })
    }
  }, [cardId])

  useEffect(() => { void load() }, [load])

  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name)
    try {
      await fn()
      toast(ok, { tone: 'success' })
      await load()
      onChanged()
    } catch (err) {
      toast(errorText(err, 'Det gick inte.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open title={card ? `Presentkort ****${card.last4}` : 'Presentkort'} onClose={onClose} size="wide">
      {!card ? <p className="cell-muted">Hämtar…</p> : (
        <>
          <dl className="presentkort-facts">
            <dt>Saldo</dt><dd>{kr(card.balanceOre)} av {card.initialSek.toLocaleString('sv-SE')} kr</dd>
            <dt>Status</dt><dd>{STATUS_LABEL[card.status]}</dd>
            <dt>Gäller till</dt><dd>{card.expiresAt.slice(0, 10)}</dd>
            {card.recipientName ? <><dt>Till</dt><dd>{card.recipientName}</dd></> : null}
          </dl>
          <h3 className="presentkort-sub">Historik</h3>
          <ul className="presentkort-history">
            {card.transactions.map((t) => (
              <li key={t.txId}>
                <span>{t.at.slice(0, 10)} {KIND_LABEL[t.kind] ?? t.kind}</span>
                <span>{t.amountOre ? kr(t.amountOre) : ''}</span>
              </li>
            ))}
          </ul>
          {card.status === 'active' ? (
            <div className="form-grid">
              <Field label="Förläng till"><Input type="date" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} /></Field>
              <Field label="Anledning" hint="Sparas i historiken." required><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
              <Bar variant="action" label="Presentkortet">
                <Button variant="secondary" disabled={!extendTo || !reason.trim()} busy={busy === 'extend'}
                  onClick={() => void run('extend', () => extendCard(card.cardId, `${extendTo}T21:59:59Z`, reason.trim()), 'Giltigheten är förlängd.')}>
                  Förläng
                </Button>
                {confirmResend ? null : (
                  <Button variant="secondary" onClick={() => setConfirmResend(true)}>
                    Skicka ny kod
                  </Button>
                )}
                <Button variant="danger" disabled={!reason.trim()} busy={busy === 'refund'}
                  onClick={() => void run('refund', () => refundCard(card.cardId, reason.trim()), 'Det som var kvar är återbetalt till köparen.')}>
                  Återbetala
                </Button>
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
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getSettings().then((s) => { setDraft(s); setAmounts(s.amountsSek.join(', ')) }).catch(() => setDraft(null))
  }, [])

  if (!draft) return null

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      const list = amounts.split(/[,\s]+/).filter(Boolean).map(Number)
      const saved = await saveSettings({ ...draft, amountsSek: list })
      setDraft(saved)
      setAmounts(saved.amountsSek.join(', '))
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara.', ERRORS), { tone: 'danger' })
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
        <Field label="Färdiga belopp (kr)" hint="Komma mellan, till exempel 250, 500, 1000." required>
          <Input value={amounts} onChange={(e) => setAmounts(e.target.value)} />
        </Field>
        <Field label="Eget belopp, lägst (kr)" required>
          <Input type="number" min={100} max={5000} value={String(draft.customMinSek)} onChange={(e) => setDraft({ ...draft, customMinSek: Number(e.target.value) })} />
        </Field>
        <Field label="Eget belopp, högst (kr)" required>
          <Input type="number" min={100} max={5000} value={String(draft.customMaxSek)} onChange={(e) => setDraft({ ...draft, customMaxSek: Number(e.target.value) })} />
        </Field>
        <Field label="Giltighet (månader)" hint="Minst 12 månader. Visas för köparen." required>
          <Input type="number" min={12} max={60} value={String(draft.validityMonths)} onChange={(e) => setDraft({ ...draft, validityMonths: Number(e.target.value) })} />
        </Field>
        <Bar variant="action" label="Spara presentkortsinställningar">
          <Button type="submit" busy={saving} busyLabel="Sparar…">Spara</Button>
        </Bar>
      </form>
    </Card>
  )
}
