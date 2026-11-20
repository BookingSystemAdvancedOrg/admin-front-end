import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { COUNTER_LABEL, ERRORS, OUTCOME_LABEL, deleteRecording, getCall, when, type CallDetail as Detail } from './api'
import { ErrorActions } from '../../shared/ErrorNote'
import { SkelLines } from '../../shared/Skeleton'
import { BackButton } from '../../shared/BackButton'
import { useTenant } from '../../shared/tenant'
import { Transcript } from './Transcript'
import { translationState } from './transcriptText'

/** /telefon/samtal/:callId: utskriften, beviset för AI-upplysningen och inspelningen (bara ägaren). */
export default function CallDetail({ locationId, callId, owner }: { locationId: string; callId: string; owner: boolean }) {
  const [call, setCall] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { sub } = useTenant()

  const load = useCallback(async () => {
    try {
      setCall(await getCall(locationId, callId))
      setError(null)
    } catch (err) {
      setError(errorText(err, 'Samtalet kunde inte visas.', ERRORS))
    }
  }, [locationId, callId])

  useEffect(() => { void load() }, [load])
  // Tätare medan översättningen pågår, så utskriften byts när den är klar.
  const translating = call ? translationState(call.turns, call) === 'pending' : false
  useLiveRefresh(async () => {
    setCall(await getCall(locationId, callId))
    setError(null)
  }, { everyMs: translating ? 5_000 : undefined })

  async function removeRecording() {
    setBusy(true)
    try {
      await deleteRecording(locationId, callId)
      toast('Inspelningen är raderad.', { tone: 'success' })
      await load()
    } catch (err) {
      toast(errorText(err, 'Inspelningen raderades inte.', ERRORS), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <div className="back-row"><BackButton to="/telefon">Tillbaka till samtalen</BackButton></div>
    <Card title="Samtal">
      {error ? <Bar variant="banner" tone="danger" action={<ErrorActions text={error} onRetry={() => { setError(null); void load() }} />}>{error}</Bar> : !call ? (
        <div role="status" aria-label="Hämtar samtalet"><SkelLines n={5} /></div>
      ) : (
        <>
          <dl className="telefon-facts">
            <dt>När</dt><dd className="telefon-nowrap">{when(call.startedAt)}</dd>
            {owner && call.from ? <><dt>Från</dt><dd className="telefon-mono">{call.from}</dd></> : null}
            <dt>Utfall</dt><dd>{call.outcome ? OUTCOME_LABEL[call.outcome] : 'Pågår'}{call.counterOffer !== 'none' ? `, ${COUNTER_LABEL[call.counterOffer].toLowerCase()}` : ''}</dd>
            <dt>Minuter</dt><dd>{call.billedMinutes}</dd>
            <dt>AI-upplysning</dt>
            <dd>
              {call.disclosure.playedAt ? <>Spelades upp <span className="telefon-nowrap">{when(call.disclosure.playedAt)}</span></> : 'Sades i hälsningen'}
              {call.disclosure.repeats ? <>, <span className="telefon-nowrap">upprepad {call.disclosure.repeats} gång{call.disclosure.repeats > 1 ? 'er' : ''}</span></> : null}
            </dd>
          </dl>
          {owner && call.recordingUrl ? (
            <div className="telefon-recording">
              <audio controls src={call.recordingUrl} aria-label="Inspelning av samtalet" />
              <Button variant="danger" size="sm" busy={busy} busyLabel="Raderar…" onClick={() => void removeRecording()}>Radera inspelningen</Button>
            </div>
          ) : null}
          <Transcript turns={call.turns} call={call} userKey={sub ?? 'du'} />
        </>
      )}
    </Card>
    </>
  )
}
