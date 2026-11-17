import { useLiveRefresh } from '../../shared/live'
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, toast } from '@booqy/brand'
import { ErrorNote } from '../../shared/ErrorNote'
import { SkelRows } from '../../shared/Skeleton'
import { errorText } from '../../shared/errors'
import { ERRORS, closeCallback, listCallbacks, when, type Callback } from './api'

/** Telefon > Återuppringningar: alla som vill bli uppringda. Samma lista som panelen i Bokningar. */
export default function CallbacksTab({ locationId }: { locationId: string }) {
  return <CallbackList locationId={locationId} title="Vill bli uppringda" />
}

export function CallbackList({ locationId, title, compact = false }: { locationId: string; title: string; compact?: boolean }) {
  const [items, setItems] = useState<Callback[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await listCallbacks(locationId))
      setError(null)
    } catch (err) {
      // Ett fel är inte en tom lista: listan står kvar (eller hämtas inte), felet visas i kortet.
      setError(errorText(err, 'Återuppringningarna kunde inte visas.', ERRORS))
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])
  useLiveRefresh(async () => {
    setItems(await listCallbacks(locationId))
    setError(null)
  })

  async function close(cb: Callback) {
    setBusy(cb.callbackId)
    try {
      await closeCallback(locationId, cb)
      await load()
    } catch (err) {
      toast(errorText(err, 'Återuppringningen markerades inte som klar.', ERRORS), { tone: 'danger' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (compact && !error && (!items || items.length === 0)) return null
  return (
    <Card title={<>{title} {items ? <span className="status-badge" aria-label={`${items.length} väntar`}>{items.length}</span> : null}</>}>
      <ErrorNote text={error} onRetry={() => void load()} />
      {!items ? (error ? null : <div role="status" aria-label="Hämtar återuppringningarna"><SkelRows n={3} cols={2} /></div>) : items.length === 0 ? <p className="admin-empty">Inga återuppringningar.</p> : (
        <ul className="telefon-callbacks">
          {items.map((cb) => (
            <li key={cb.callbackId}>
              <div>
                <strong>{cb.name || 'Okänt namn'}</strong>
                <span className="cell-muted"> {when(cb.createdAt)}</span>
                <div>{cb.topic}</div>
              </div>
              <div className="telefon-callbacks__actions">
                {cb.phone ? <a className="card-link telefon-mono" href={`tel:${cb.phone}`}>Ring upp {cb.phone}</a> : null}
                <Button size="sm" variant="secondary" busy={busy === cb.callbackId} busyLabel="Sparar…" onClick={() => void close(cb)}>Klar</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
