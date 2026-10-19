import { useCallback, useEffect, useState } from 'react'
import { Loading } from '../../shared/Loading'
import {
  SUBSCRIBER_STATUS_CLASS,
  SUBSCRIBER_STATUS_LABEL,
  eraseSubscriber,
  errorText,
  exportSubscribers,
  formatDateTime,
  listSubscribers,
  unsubscribe,
} from './marketingApi'
import type { Subscriber, SubscriberStatus } from './marketingApi'
import { useEscape } from './useEscape'

/**
 * Gäster som kryssat i "erbjudanden" när de bokade. Ägaren kan avregistrera
 * någon (t.ex. efter ett samtal), radera en person helt (GDPR) och ladda ned
 * listan som CSV. Nya mottagare läggs bara till av gästen själv.
 */
export function SubscribersTab() {
  const [status, setStatus] = useState<SubscriberStatus | ''>('subscribed')
  // Listan hör till ett filter; ett annat filter visar laddning direkt.
  const [list, setList] = useState<{ status: SubscriberStatus | ''; rows: Subscriber[]; cursor: string | null } | null>(null)
  const [reload, setReload] = useState(0)
  const rows = list?.status === status ? list.rows : null
  const cursor = list?.status === status ? list.cursor : null
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmErase, setConfirmErase] = useState<Subscriber | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    listSubscribers(status)
      .then((page) => !cancelled && setList({ status, rows: page.subscribers, cursor: page.cursor }))
      .catch((err: unknown) => !cancelled && setError(errorText(err, 'Kunde inte hämta mottagarna.')))
    return () => {
      cancelled = true
    }
  }, [status, reload])

  const closeConfirm = useCallback(() => setConfirmErase(null), [])
  useEscape(closeConfirm, confirmErase !== null)

  const load = () => {
    setError(null)
    setList(null)
    setReload((n) => n + 1)
  }

  const more = async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listSubscribers(status, cursor)
      setList((l) => ({ status, rows: [...(l?.rows ?? []), ...page.subscribers], cursor: page.cursor }))
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta fler.'))
    } finally {
      setLoadingMore(false)
    }
  }

  const doUnsubscribe = async (s: Subscriber) => {
    setNotice(null)
    try {
      await unsubscribe(s.subscriberId)
      setNotice(`${s.email} får inga fler utskick.`)
      load()
    } catch (err) {
      setError(errorText(err, 'Kunde inte avregistrera.'))
    }
  }

  const doErase = async (s: Subscriber) => {
    setConfirmErase(null)
    setNotice(null)
    try {
      await eraseSubscriber(s.subscriberId)
      setNotice(`${s.email} är raderad från mottagarlistan.`)
      load()
    } catch (err) {
      setError(errorText(err, 'Kunde inte radera.'))
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
      {error && <p className="form-error" role="alert">{error}</p>}
      <section className="admin-card table-card">
        <div className="card-head">
          <h2 className="card-title">Mottagare</h2>
          <div className="row-actions">
            <select className="compact-select" aria-label="Visa" value={status} onChange={(e) => {
                setError(null)
                setStatus(e.target.value as SubscriberStatus | '')
              }}>
              <option value="subscribed">Prenumererar</option>
              <option value="unsubscribed">Avregistrerade</option>
              <option value="bounced">Studsar</option>
              <option value="complained">Markerade som skräppost</option>
              <option value="">Alla</option>
            </select>
            <button type="button" className="btn outline square" disabled={exporting} onClick={() => void doExport()}>
              {exporting ? 'Laddar ned…' : 'Ladda ned CSV'}
            </button>
          </div>
        </div>
        {rows === null && !error && <Loading />}
        {rows !== null && rows.length === 0 && (
          <p className="cell-muted">
            {status === 'subscribed'
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
                      {s.name || s.email}
                      {s.name && <div className="cell-muted">{s.email}</div>}
                    </td>
                    <td><span className={`status-badge ${SUBSCRIBER_STATUS_CLASS[s.status]}`}>{SUBSCRIBER_STATUS_LABEL[s.status]}</span></td>
                    <td className="cell-muted">{formatDateTime(s.consentAt)}</td>
                    <td className="cell-muted">{s.lastVisit ? s.lastVisit.slice(0, 10) : '-'}</td>
                    <td className="mk-row-actions">
                      {s.status === 'subscribed' && (
                        <button type="button" className="link-action" onClick={() => void doUnsubscribe(s)}>Avregistrera</button>
                      )}
                      <button type="button" className="link-action danger" onClick={() => setConfirmErase(s)}>Radera</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <button type="button" className="btn outline square mk-more" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? 'Hämtar…' : 'Visa fler'}
          </button>
        )}
      </section>
      <p className="mk-footnote cell-muted">
        Adresser som studsar eller markerar utskick som skräppost stängs av automatiskt.
      </p>

      {confirmErase && (
        <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && setConfirmErase(null)}>
          <div className="modal modal--confirm" role="dialog" aria-modal="true" aria-label="Radera mottagaren">
            <h2>Radera {confirmErase.email}?</h2>
            <p className="modal-text">
              Personen tas bort från mottagarlistan för gott (t.ex. när gästen ber om att bli raderad). Bokar gästen igen
              och kryssar i erbjudanden läggs hen till på nytt.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn outline square" autoFocus onClick={() => setConfirmErase(null)}>Avbryt</button>
              <button type="button" className="btn danger-outline square" onClick={() => void doErase(confirmErase)}>Radera</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
