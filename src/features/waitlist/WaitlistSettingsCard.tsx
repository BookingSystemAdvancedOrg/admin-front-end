import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { ErrorNote } from '../../shared/ErrorNote'
import { SkelCard } from '../../shared/Skeleton'
import { useTenant } from '../../shared/tenant'
import { ERRORS, getQueue, saveSettings, type Settings } from './api'
import './waitlist.css'

function today(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/** Inställningar, Restaurangen, Bokning: kön på/av, hålltid, max antal och kö från hemsidan (ägaren). */
export default function WaitlistSettingsCard({ locationId }: { locationId: string }) {
  // Bara ägaren kan spara köinställningarna (servern svarar owner_only).
  const { tenant } = useTenant()
  if (tenant?.role !== 'owner_user') return null
  return <SettingsForm locationId={locationId} />
}

function SettingsForm({ locationId }: { locationId: string }) {
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => {
    let live = true
    setLoadError(null)
    getQueue(locationId, today()).then((q) => { if (live) setDraft(q.settings) })
      .catch((err) => { if (live) setLoadError(errorText(err, 'Kunde inte hämta kön.', ERRORS)) })
    return () => { live = false }
  }, [locationId])

  useEffect(() => load(), [load])

  if (!draft) {
    return loadError
      ? <Card title="Kö"><ErrorNote text={loadError} onRetry={() => { load() }} /></Card>
      : <SkelCard rows={3} cols={2} aside={false} />
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      setDraft(await saveSettings(locationId, draft))
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Kö">
      <form className="form-grid" onSubmit={save} aria-label="Köinställningar">
        <fieldset className="queue-checks">
          <legend>Kön</legend>
          <label><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> På</label>
          <label><input type="checkbox" checked={draft.publicJoin} onChange={(e) => setDraft({ ...draft, publicJoin: e.target.checked })} /> Kö från hemsidan</label>
        </fieldset>
        <Field label="Hålltid (minuter)" hint="5-30 min" required>
          <Input type="number" min={5} max={30} value={String(draft.holdMinutes)} required
            onChange={(e) => setDraft({ ...draft, holdMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Max antal i kö" hint="1-200 sällskap" required>
          <Input type="number" min={1} max={200} value={String(draft.maxWaiting)} required
            onChange={(e) => setDraft({ ...draft, maxWaiting: Number(e.target.value) })} />
        </Field>
        <Bar variant="action" label="Spara köinställningar" className="queue-actions">
          <Button type="submit" busy={saving} busyLabel="Sparar…">Spara</Button>
        </Bar>
      </form>
    </Card>
  )
}
