import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { isRowOpenKey, shouldOpenRow } from '../meny/rowClick'
import { COUNTER_LABEL, ERRORS, OUTCOME_LABEL, REFUSED_LABEL, daysAgo, listCalls, today, when, type CallRow } from './api'

/** Telefon > Samtal: veckans samtal, senaste först, med utfall och om assistenten erbjöd något annat. */
export default function CallsTab({ locationId, owner }: { locationId: string; owner: boolean }) {
  const [calls, setCalls] = useState<CallRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const [paged, setPaged] = useState(false)
  const load = useCallback(async (after?: string | null) => {
    setPaged(Boolean(after))
    setBusy(true)
    try {
      const page = await listCalls(locationId, daysAgo(6), today(), after)
      setCalls((prev) => (after ? [...(prev ?? []), ...page.calls] : page.calls))
      setCursor(page.cursor)
    } catch (err) {
      toast(errorText(err, 'Kunde inte hämta samtalen.', ERRORS), { tone: 'danger' })
      setCalls((prev) => prev ?? [])
    } finally {
      setBusy(false)
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])
  // Levande bara för första sidan (inte efter "Visa fler").
  useLiveRefresh(async () => {
    const page = await listCalls(locationId, daysAgo(6), today(), null)
    setCalls(page.calls)
    setCursor(page.cursor)
  }, { enabled: calls !== null && !busy && !paged })

  return (
    <Card title="Samtal senaste veckan">
      {!calls ? <p className="cell-muted">Hämtar…</p> : calls.length === 0 ? (
        <p className="admin-empty">Inga samtal senaste veckan.</p>
      ) : (
        <div className="table-scroll" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">När</th>{owner ? <th scope="col">Från</th> : null}<th scope="col">Utfall</th>
                <th scope="col">Sammanfattning</th><th scope="col">Längd</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                // Hela raden öppnar samtalet (klick eller Enter).
                <tr
                  key={c.callId}
                  className="person-row"
                  tabIndex={0}
                  aria-label={`Samtal ${when(c.startedAt)}, öppna`}
                  onClick={(e) => { if (shouldOpenRow(e.target, e.currentTarget)) navigate(`/telefon/samtal/${encodeURIComponent(c.callId)}`) }}
                  onKeyDown={(e) => { if (isRowOpenKey(e)) { e.preventDefault(); navigate(`/telefon/samtal/${encodeURIComponent(c.callId)}`) } }}
                >
                  <td>{when(c.startedAt)}</td>
                  {owner ? <td className="telefon-mono">{c.from ?? '-'}</td> : null}
                  <td>
                    <span className="status-badge">{c.outcome ? OUTCOME_LABEL[c.outcome] : 'Pågår'}</span>
                    {c.counterOffer !== 'none' ? <span className="cell-muted"> {COUNTER_LABEL[c.counterOffer]}</span> : null}
                    {c.outcome === 'refused' && c.refusedReason ? <span className="cell-muted"> ({REFUSED_LABEL[c.refusedReason] ?? c.refusedReason})</span> : null}
                  </td>
                  <td>{c.summary}</td>
                  <td>{Math.max(0, Math.round(c.durationSec / 60))} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor ? <Button variant="secondary" busy={busy} busyLabel="Hämtar…" onClick={() => void load(cursor)}>Visa fler</Button> : null}
    </Card>
  )
}
