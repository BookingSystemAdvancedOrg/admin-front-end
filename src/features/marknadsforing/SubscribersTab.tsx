import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Loading } from '../../shared/Loading'
import {
  SUBSCRIBER_STATUS_CLASS,
  SUBSCRIBER_STATUS_LABEL,
  errorText,
  exportSubscribers,
  findSubscriber,
  formatDateTime,
  listSubscribers,
} from './marketingApi'
import type { Subscriber, SubscriberFilter } from './marketingApi'
import { ConsentHistory, EraseGuestDialog, KeptList } from '../installningar/PrivacyCard'
import { eraseGuest, eraseSummary, lookupConsent, withdrawConsent } from '../installningar/privacyApi'
import type { ChannelConsent, EraseResult } from '../installningar/privacyApi'
import '../installningar/privacy.css'
import { useEscape } from './useEscape'

const CONSENT_SOURCE: Record<string, string> = {
  booking: 'Vid bokning',
  order: 'Vid beställning',
  catering: 'Cateringförfrågan',
  welcome_offer: 'Välkomsterbjudandet',
}

/** Listan som visas: ett filter, eller en sökning på en adress. */
type View = { filter: SubscriberFilter; email: string | null }

/**
 * Gäster som kryssat i "erbjudanden". Ägaren kan söka på en adress, se
 * samtyckeshistoriken, avregistrera någon (t.ex. efter ett samtal), radera en
 * gästs uppgifter (GDPR) och ladda ned listan som CSV. Avregistrera och radera
 * går via gästintegriteten, så varje återkallelse står i samtyckesloggen.
 * Nya mottagare läggs bara till av gästen själv.
 */
export function SubscribersTab() {
  const [view, setView] = useState<View>({ filter: 'subscribed', email: null })
  const [query, setQuery] = useState('')
  // Listan hör till en vy; en annan vy visar laddning direkt.
  const [list, setList] = useState<{ view: View; rows: Subscriber[]; cursor: string | null } | null>(null)
  const [reload, setReload] = useState(0)
  const rows = list?.view === view ? list.rows : null
  const cursor = list?.view === view ? list.cursor : null
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [erased, setErased] = useState<EraseResult | null>(null)
  const [confirmErase, setConfirmErase] = useState<Subscriber | null>(null)
  const [erasing, setErasing] = useState(false)
  const [history, setHistory] = useState<{ subscriber: Subscriber; consent: ChannelConsent | null } | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const page = view.email ? findSubscriber(view.email) : listSubscribers(view.filter)
    page
      .then((p) => !cancelled && setList({ view, rows: p.subscribers, cursor: p.cursor }))
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta mottagarna.')))
    return () => {
      cancelled = true
    }
  }, [view, reload])

  const closeConfirm = useCallback(() => !erasing && setConfirmErase(null), [erasing])
  const closeHistory = useCallback(() => setHistory(null), [])
  useEscape(closeConfirm, confirmErase !== null)
  useEscape(closeHistory, history !== null)

  const load = () => {
    setError(null)
    setList(null)
    setReload((n) => n + 1)
  }

  const show = (next: View) => {
    setError(null)
    setNotice(null)
    setErased(null)
    setView(next)
  }

  const search = (e: FormEvent) => {
    e.preventDefault()
    const email = query.trim().toLowerCase()
    if (!email) {
      show({ filter: view.filter, email: null })
      return
    }
    show({ filter: view.filter, email })
  }

  const more = async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listSubscribers(view.filter, cursor)
      setList((l) => ({ view, rows: [...(l?.rows ?? []), ...page.subscribers], cursor: page.cursor }))
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta fler.'))
    } finally {
      setLoadingMore(false)
    }
  }

  const doUnsubscribe = async (s: Subscriber) => {
    if (!s.email) return
    setNotice(null)
    setErased(null)
    try {
      await withdrawConsent(['email'], s.email)
      setNotice(`${s.email} får inga fler utskick.`)
      load()
    } catch (err) {
      setError(errorText(err, 'Kunde inte avregistrera.'))
    }
  }

  const doErase = async (s: Subscriber) => {
    if (!s.email) return
    setNotice(null)
    setErasing(true)
    try {
      setErased(await eraseGuest(s.email))
      setConfirmErase(null)
      load()
    } catch (err) {
      setConfirmErase(null)
      setError(errorText(err, 'Kunde inte radera.'))
    } finally {
      setErasing(false)
    }
  }

  const openHistory = async (s: Subscriber) => {
    if (!s.email) return
    setHistory({ subscriber: s, consent: null })
    try {
      const r = await lookupConsent(s.email)
      setHistory((h) => (h?.subscriber === s ? { subscriber: s, consent: r.email ?? { state: 'none', history: [] } } : h))
    } catch (err) {
      setHistory(null)
      setError(errorText(err, 'Kunde inte hämta historiken.'))
    }
  }

  const doExport = async () => {
    setExporting(true)
    setError(null)
    try {
      await exportSubscribers()
    } catch (err) {
      setError(errorText(err, 'Kunde inte ladda ned listan.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="mk-stack">
      {notice && <p className="save-notice" role="status">{notice}</p>}
      {erased && (
        <div className="save-notice privacy-erased" role="status">
          <p>{eraseSummary(erased)}</p>
          <KeptList items={erased.kept} />
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="admin-card table-card">
        <div className="card-head">
          <h2 className="card-title">Mottagare</h2>
          <div className="row-actions">
            <select className="compact-select" aria-label="Visa" value={view.filter} onChange={(e) => {
                setQuery('')
                show({ filter: e.target.value as SubscriberFilter, email: null })
              }}>
              <option value="subscribed">Prenumererar</option>
              <option value="pending">Väntar på bekräftelse</option>
              <option value="unsubscribed">Avregistrerade</option>
              <option value="suppressed">Spärrade</option>
              <option value="">Alla</option>
            </select>
            <button type="button" className="btn outline square" disabled={exporting} onClick={() => void doExport()}>
              {exporting ? 'Laddar ned…' : 'Ladda ned CSV'}
            </button>
          </div>
        </div>
        <form className="mk-sub-search" role="search" onSubmit={search}>
          <label className="sr-only" htmlFor="mk-sub-email">Sök på e-post</label>
          <input
            id="mk-sub-email"
            type="email"
            placeholder="Sök på e-post"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn outline square">Sök</button>
          {view.email && (
            <button type="button" className="btn outline square" onClick={() => {
                setQuery('')
                show({ filter: view.filter, email: null })
              }}>
              Visa alla
            </button>
          )}
        </form>
        {rows === null && !error && <Loading />}
        {rows !== null && rows.length === 0 && (
          <p className="cell-muted">
            {view.email
              ? `Ingen mottagare med adressen ${view.email}.`
              : view.filter === 'subscribed'
                ? 'Inga prenumeranter än. Gäster som kryssar i "erbjudanden" när de bokar bord hamnar här.'
                : 'Inga att visa.'}
          </p>
        )}
        {rows && rows.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Gäst</th>
                  <th>Status</th>
                  <th>Samtycke</th>
                  <th>Senaste besök</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.subscriberId}>
                    <td className="cell-strong">
                      {s.email ? (s.name || s.email) : <span className="cell-muted">Adressen raderad, spärren finns kvar</span>}
                      {s.email && s.name && <div className="cell-muted">{s.email}</div>}
                    </td>
                    <td><span className={`status-badge ${SUBSCRIBER_STATUS_CLASS[s.status]}`}>{SUBSCRIBER_STATUS_LABEL[s.status]}</span></td>
                    <td className="cell-muted">
                      {formatDateTime(s.consentAt)}
                      {s.consentSource && <div>{CONSENT_SOURCE[s.consentSource] ?? s.consentSource}</div>}
                    </td>
                    <td className="cell-muted">{s.lastVisit ? s.lastVisit.slice(0, 10) : '-'}</td>
                    <td className="mk-row-actions">
                      {s.email && (
                        <button type="button" className="link-action" onClick={() => void openHistory(s)}>Historik</button>
                      )}
                      {s.email && s.status === 'subscribed' && (
                        <button type="button" className="link-action" onClick={() => void doUnsubscribe(s)}>Avregistrera</button>
                      )}
                      {s.email && (
                        <button type="button" className="link-action danger" onClick={() => setConfirmErase(s)}>Radera</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && !view.email && (
          <button type="button" className="btn outline square mk-more" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? 'Hämtar…' : 'Visa fler'}
          </button>
        )}
      </section>
      <p className="mk-footnote cell-muted">
        Adresser som studsar eller markerar utskick som skräppost spärras automatiskt (Spärrade). Efter 30 dagar
        raderas adressen och bara spärren finns kvar.
      </p>

      {confirmErase?.email && (
        <EraseGuestDialog
          who={confirmErase.email}
          busy={erasing}
          onCancel={() => setConfirmErase(null)}
          onConfirm={() => void doErase(confirmErase)}
        />
      )}

      {history && (
        <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && setHistory(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Samtyckeshistorik">
            <h2>Historik för {history.subscriber.email}</h2>
            {history.consent === null && <Loading />}
            {history.consent && history.consent.history.length === 0 && (
              <p className="modal-text">Inga rader i samtyckesloggen (mottagaren kom till före loggen).</p>
            )}
            {history.consent && history.consent.history.length > 0 && <ConsentHistory history={history.consent.history} />}
            <div className="modal-actions">
              <button type="button" className="btn outline square" autoFocus onClick={() => setHistory(null)}>Stäng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
