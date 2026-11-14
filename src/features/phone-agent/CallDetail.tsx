import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { COUNTER_LABEL, ERRORS, OUTCOME_LABEL, deleteRecording, getCall, when, type CallDetail as Detail } from './api'
import { ErrorActions } from '../../shared/ErrorNote'

const ROLE: Record<string, string> = { agent: 'Assistenten', caller: 'Den som ringde', tool: 'Bokningssystemet', system: 'System' }

/** /telefon/samtal/:callId: utskriften, beviset för AI-upplysningen och inspelningen (bara ägaren). */
export default function CallDetail({ locationId, callId, owner, onBack }: { locationId: string; callId: string; owner: boolean; onBack: () => void }) {
  const [call, setCall] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setCall(await getCall(locationId, callId))
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta samtalet.', ERRORS))
    }
  }, [locationId, callId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => setCall(await getCall(locationId, callId)))

  async function removeRecording() {
    setBusy(true)
    try {
      await deleteRecording(locationId, callId)
      toast('Inspelningen är raderad.', { tone: 'success' })
      await load()
    } catch (err) {
      toast(errorText(err, 'Kunde inte radera inspelningen.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Samtal" actions={<Button variant="ghost" onClick={onBack}>Tillbaka till samtalen</Button>}>
      {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} />}>{error}</Bar> : !call ? <p className="cell-muted">Hämtar…</p> : (
        <>
          <dl className="telefon-facts">
            <dt>När</dt><dd>{when(call.startedAt)}</dd>
            {owner && call.from ? <><dt>Från</dt><dd className="telefon-mono">{call.from}</dd></> : null}
            <dt>Utfall</dt><dd>{call.outcome ? OUTCOME_LABEL[call.outcome] : 'Pågår'}{call.counterOffer !== 'none' ? `, ${COUNTER_LABEL[call.counterOffer].toLowerCase()}` : ''}</dd>
            <dt>Minuter</dt><dd>{call.billedMinutes}</dd>
            <dt>AI-upplysning</dt>
            <dd>
              {call.disclosure.playedAt ? `Spelades upp ${when(call.disclosure.playedAt)}` : 'Sades i hälsningen'}
              {call.disclosure.repeats ? `, upprepad ${call.disclosure.repeats} gång${call.disclosure.repeats > 1 ? 'er' : ''}` : ''}
            </dd>
          </dl>
          {owner && call.recordingUrl ? (
            <div className="telefon-recording">
              <audio controls src={call.recordingUrl} aria-label="Inspelning av samtalet" />
              <Button variant="danger" size="sm" busy={busy} busyLabel="Raderar…" onClick={() => void removeRecording()}>Radera inspelningen</Button>
            </div>
          ) : null}
          <h3 className="telefon-sub">Utskrift</h3>
          <ol className="telefon-transcript">
            {call.turns.filter((t) => t.role !== 'tool').map((t, i) => (
              <li key={i} className={`telefon-turn telefon-turn--${t.role}`}>
                <span className="telefon-turn__who">{ROLE[t.role] ?? t.role}</span>
                <span>{t.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  )
}
