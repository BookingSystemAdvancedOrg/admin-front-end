import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../../shared/api'
import { PhoneInput } from '../../shared/PhoneInput'
import {
  NOTICE_MAX,
  downloadJson,
  eraseGuest,
  eraseSummary,
  exportGuest,
  getPrivacyNotice,
  lookupConsent,
  resetPrivacyNotice,
  savePrivacyNotice,
  withdrawConsent,
} from './privacyApi'
import type {
  ChannelConsent,
  ConsentChannel,
  ConsentLookup,
  ConsentRecord,
  EraseResult,
  KeptItem,
  PrivacyNotice,
} from './privacyApi'
import './privacy.css'

/**
 * Integritet: restaurangen är personuppgiftsansvarig för sina gäster.
 *
 * 1. Integritetspolicyn gästerna ser på sajten. Startar från en mall med
 *    restaurangens namn, org.nr, adress, kontakt och lagringstider; ägaren
 *    kan skriva om den. Vanlig text: "## " rubrik, "- " punkt.
 * 2. Samtycken till erbjudanden: slå upp en gäst (e-post och/eller
 *    telefon), se historiken och återkalla samtycket åt gästen. Påverkar
 *    bara erbjudanden, aldrig bekräftelser eller kvitton. Inget skrivs över:
 *    en återkallelse är en ny rad i loggen.
 * 3. Gästens uppgifter: exportera allt som finns sparat (JSON) eller radera
 *    det när gästen ber om det. Kvitton och påskrivna avtal finns kvar utan
 *    kontaktuppgifter (bokföringslagen); pågående bokningar och beställningar
 *    behålls tills de är avbokade.
 */

const CHANNEL_LABEL: Record<ConsentChannel, string> = { email: 'E-post', sms: 'SMS' }
const STATE_LABEL: Record<ChannelConsent['state'], string> = {
  granted: 'Samtycke gäller',
  withdrawn: 'Återkallat',
  none: 'Inget samtycke',
}
const SOURCE_LABEL: Record<string, string> = {
  booking: 'bokning',
  order: 'beställning',
  catering: 'cateringförfrågan',
  welcome_offer: 'välkomsterbjudande',
  withdraw_page: 'gästens egen länk',
  unsubscribe_link: 'avregistreringslänk i mejl',
  admin: 'restaurangen',
  complaint: 'markerat som skräppost',
  legacy: 'före samtyckesloggen',
  erasure: 'radering på gästens begäran',
}

const KEPT_KIND: Record<KeptItem['kind'], string> = { booking: 'Bokning', order: 'Beställning', catering: 'Catering' }
// Det som behålls vid radering är alltid något som pågår (se guest-privacy).
const KEPT_STATUS: Record<string, string> = {
  reserved: 'bokad',
  pending: 'väntar på kortgaranti',
  pending_payment: 'väntar på betalning',
  confirmed: 'bekräftad',
  preparing: 'tillagas',
  ready: 'klar att hämta',
  requested: 'ny förfrågan',
  offer_sent: 'offert skickad',
  change_requested: 'ändring begärd',
  signed: 'påskriven',
}

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) return 'Bara restaurangens ägare kan göra det här.'
  if (err instanceof ApiError && err.status === 400) return 'Kontrollera uppgifterna och försök igen.'
  return fallback
}

function recordLabel(r: ConsentRecord): string {
  const source = SOURCE_LABEL[r.source] ?? r.source
  if (r.action === 'grant') return `Samtycke lämnat (${source})`
  if (r.action === 'withdraw') return `Återkallat (${source})`
  return 'Bara spärr kvar (uppgifterna raderade)'
}

/** Samtyckeshistoriken för en kanal, nyast först. */
export function ConsentHistory({ history }: { history: ConsentRecord[] }) {
  return (
    <ol className="consent-history">
      {history.map((r, i) => (
        <li key={`${r.at}-${i}`}>
          <span className="consent-when">{when(r.at)}</span>
          <span>{recordLabel(r)}</span>
          {r.text && (
            <details>
              <summary>Ordalydelse ({r.textVersion})</summary>
              <p>{r.text}</p>
            </details>
          )}
        </li>
      ))}
    </ol>
  )
}

export function KeptList({ items }: { items: KeptItem[] }) {
  if (!items.length) return null
  return (
    <ul className="privacy-kept">
      {items.map((k) => (
        <li key={`${k.kind}-${k.id}`}>
          {KEPT_KIND[k.kind]} {k.date ?? ''} <span className="cell-muted">({(k.status && KEPT_STATUS[k.status]) ?? k.status ?? 'okänd status'})</span>
        </li>
      ))}
    </ul>
  )
}

/** Bekräftelse innan en gästs uppgifter raderas. */
export function EraseGuestDialog({ who, busy, onCancel, onConfirm }: {
  who: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label="Radera gästens uppgifter">
        <h2>Radera uppgifterna om {who}?</h2>
        <p className="modal-text">
          Gästen tas bort från mottagarlistan och samtycket till erbjudanden återkallas. Namn, e-post, telefon och
          meddelanden tas bort från bokningar, beställningar och cateringförfrågningar. Kvitton och påskrivna avtal
          finns kvar utan kontaktuppgifter (bokföringslagen). Kommande bokningar och pågående beställningar behålls
          tills de är avbokade. Det går inte att ångra.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn outline square" autoFocus disabled={busy} onClick={onCancel}>Avbryt</button>
          <button type="button" className="btn danger-outline square" disabled={busy} onClick={onConfirm}>
            {busy ? 'Raderar…' : 'Radera'}
          </button>
        </div>
      </div>
    </div>
  )
}

function NoticeEditor() {
  const [saved, setSaved] = useState<PrivacyNotice | null>(null)
  const [template, setTemplate] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getPrivacyNotice()
      .then((r) => {
        if (!live) return
        setSaved(r.notice)
        setTemplate(r.template)
        setText(r.notice.body)
      })
      .catch((err) => live && setError(errorText(err, 'Kunde inte hämta integritetspolicyn.')))
    return () => {
      live = false
    }
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!text.trim()) {
      setError('Texten kan inte vara tom. Återställ mallen om du vill börja om.')
      return
    }
    setBusy(true)
    try {
      const n = await savePrivacyNotice(text.trim())
      setSaved(n)
      setText(n.body)
      setNotice('Sparat. Gästerna ser den nya texten direkt.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte spara just nu. Försök igen om en stund.'))
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!window.confirm('Ersätta texten med standardmallen? Din egen text sparas inte.')) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const n = await resetPrivacyNotice()
      setSaved(n)
      setText(n.body)
      setNotice('Standardmallen används igen.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte återställa just nu.'))
    } finally {
      setBusy(false)
    }
  }

  const dirty = saved !== null && text !== saved.body
  return (
    <section className="admin-card table-card" aria-labelledby="privacy-notice-title">
      <h2 className="card-title" id="privacy-notice-title">Integritetspolicy för gäster</h2>
      <p className="cell-muted privacy-lead">
        Ni är personuppgiftsansvariga för era gästers uppgifter. Texten visas på sajtens sida
        Integritetspolicy och länkas från varje boknings-, beställnings- och cateringformulär. Tabellen
        över cookies och lagring läggs alltid till automatiskt.
      </p>
      {saved && (
        <p className="privacy-status" role="status">
          {saved.custom ? `Egen text, version ${saved.version}, sparad ${when(saved.updatedAt)}` : 'Standardmallen (ingen egen text sparad)'}
        </p>
      )}
      <form onSubmit={save} className="privacy-form">
        <div className="form-field">
          <label htmlFor="privacy-body">Text</label>
          <textarea
            id="privacy-body"
            className="privacy-textarea"
            rows={18}
            maxLength={NOTICE_MAX}
            value={text}
            disabled={!saved || busy}
            spellCheck
            onChange={(e) => {
              setText(e.target.value)
              setNotice(null)
            }}
          />
          <p className="cell-muted privacy-hint">
            Rader som börjar med <code>## </code> blir rubriker, <code>- </code> blir punkter. {text.length.toLocaleString('sv-SE')} av{' '}
            {NOTICE_MAX.toLocaleString('sv-SE')} tecken.
          </p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <span className="row-actions">
          <button type="submit" className="btn primary square" disabled={busy || !dirty}>
            {busy ? 'Sparar…' : 'Spara text'}
          </button>
          <button
            type="button"
            className="btn outline square"
            disabled={busy || !saved || (!saved.custom && text === template)}
            onClick={reset}
          >
            Återställ mallen
          </button>
          {notice && (
            <span className="save-notice" role="status">
              {notice}
            </span>
          )}
        </span>
      </form>
    </section>
  )
}

function ConsentTool() {
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [asked, setAsked] = useState<{ email?: string; phone?: string } | null>(null)
  const [result, setResult] = useState<ConsentLookup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmErase, setConfirmErase] = useState(false)
  const [erased, setErased] = useState<EraseResult | null>(null)

  async function search(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const q = { email: email.trim() || undefined, phone: phone.trim() || undefined }
    if (!q.email && !q.phone) {
      setError('Fyll i gästens e-post, telefonnummer eller båda.')
      return
    }
    setBusy(true)
    setErased(null)
    try {
      setResult(await lookupConsent(q.email, q.phone))
      setAsked(q)
    } catch (err) {
      setResult(null)
      setError(errorText(err, 'Kunde inte söka just nu. Försök igen om en stund.'))
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(channel: ConsentChannel) {
    if (!asked) return
    const label = CHANNEL_LABEL[channel].toLowerCase()
    if (!window.confirm(`Återkalla gästens samtycke till erbjudanden via ${label}? Bekräftelser och kvitton påverkas inte.`)) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const r = await withdrawConsent([channel], asked.email, asked.phone)
      setResult(r)
      setNotice(r.withdrawn.length ? `Samtycket via ${label} är återkallat.` : 'Det fanns inget samtycke att återkalla.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte återkalla just nu. Försök igen om en stund.'))
    } finally {
      setBusy(false)
    }
  }

  async function doExport() {
    if (!asked) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      downloadJson(await exportGuest(asked.email, asked.phone), `gastdata-${new Date().toISOString().slice(0, 10)}.json`)
      setNotice('Filen är nedladdad. Skicka den till gästen på ett säkert sätt.')
    } catch (err) {
      setError(errorText(err, 'Kunde inte exportera just nu. Försök igen om en stund.'))
    } finally {
      setBusy(false)
    }
  }

  async function doErase() {
    if (!asked) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const r = await eraseGuest(asked.email, asked.phone)
      setConfirmErase(false)
      setErased(r)
      setResult(await lookupConsent(asked.email, asked.phone))
    } catch (err) {
      setConfirmErase(false)
      setError(errorText(err, 'Kunde inte radera just nu. Försök igen om en stund.'))
    } finally {
      setBusy(false)
    }
  }

  const channels = (Object.keys(CHANNEL_LABEL) as ConsentChannel[]).filter((c) => result?.[c])
  return (
    <section className="admin-card table-card" aria-labelledby="privacy-consent-title">
      <h2 className="card-title" id="privacy-consent-title">Gästens uppgifter och samtycken</h2>
      <p className="cell-muted privacy-lead">
        Om en gäst ber er sluta skicka erbjudanden: sök på e-post eller telefonnummer och återkalla
        samtycket här. Det gäller bara erbjudanden. Bekräftelser, påminnelser och kvitton skickas som vanligt.
        Vill gästen veta vad ni har sparat, eller bli raderad, exporterar eller raderar ni det också här.
      </p>
      <form onSubmit={search} className="privacy-search">
        <div className="form-field">
          <label htmlFor="consent-email">E-post</label>
          <input
            id="consent-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="consent-phone">Telefon</label>
          <PhoneInput id="consent-phone" value={phone} onChange={setPhone} />
        </div>
        <button type="submit" className="btn outline square" disabled={busy}>
          {busy && !result ? 'Söker…' : 'Sök'}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="save-notice" role="status">
          {notice}
        </p>
      )}
      {erased && (
        <div className="save-notice privacy-erased" role="status">
          <p>{eraseSummary(erased)}</p>
          <KeptList items={erased.kept} />
        </div>
      )}
      {result && asked && (
        <div className="privacy-guest-actions">
          <button type="button" className="btn outline square" disabled={busy} onClick={() => void doExport()}>
            Exportera (JSON)
          </button>
          <button type="button" className="btn danger-outline square" disabled={busy} onClick={() => setConfirmErase(true)}>
            Radera gästens uppgifter
          </button>
        </div>
      )}
      {confirmErase && asked && (
        <EraseGuestDialog
          who={[asked.email, asked.phone].filter(Boolean).join(' / ')}
          busy={busy}
          onCancel={() => setConfirmErase(false)}
          onConfirm={() => void doErase()}
        />
      )}
      {result && (
        <div className="consent-results">
          {channels.map((c) => {
            const info = result[c]!
            return (
              <article key={c} className="consent-channel" aria-label={CHANNEL_LABEL[c]}>
                <header className="consent-channel-head">
                  <h3>{CHANNEL_LABEL[c]}</h3>
                  <span className={`consent-state is-${info.state}`}>{STATE_LABEL[info.state]}</span>
                  {info.state === 'granted' && (
                    <button type="button" className="btn outline square" disabled={busy} onClick={() => withdraw(c)}>
                      Återkalla samtycke
                    </button>
                  )}
                </header>
                {info.history.length === 0 ? (
                  <p className="cell-muted">Inga uppgifter om samtycke för {asked?.[c === 'email' ? 'email' : 'phone']}.</p>
                ) : (
                  <ConsentHistory history={info.history} />
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function PrivacyCard() {
  return (
    <div className="privacy-stack">
      <NoticeEditor />
      <ConsentTool />
    </div>
  )
}
