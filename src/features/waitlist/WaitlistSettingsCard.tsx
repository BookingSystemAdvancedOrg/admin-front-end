import { useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { ERRORS, getQueue, saveSettings, type Settings } from './api'
import './waitlist.css'

function today(): string {
  return new Date().toLocaleDateString('sv-SE')
}

/** Inställningar > Bord: kön på/av, hålltid, max antal och kö från hemsidan (ägaren). */
export default function WaitlistSettingsCard({ locationId }: { locationId: string }) {
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getQueue(locationId, today()).then((q) => setDraft(q.settings)).catch(() => setDraft(null))
  }, [locationId])

  if (!draft) return null

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
      <p className="cell-muted">
        När allt är fullbokat kan gäster ställa sig i kö. När ett bord blir ledigt erbjuder ni det med ett tryck och
        gästen får ett sms. Bordet hålls för gästen så länge som hålltiden säger.
      </p>
      <form className="form-grid" onSubmit={save} aria-label="Köinställningar">
        <fieldset className="queue-checks">
          <legend>Kön</legend>
          <label><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> På</label>
          <label><input type="checkbox" checked={draft.publicJoin} onChange={(e) => setDraft({ ...draft, publicJoin: e.target.checked })} /> Gäster kan ställa sig i kö från hemsidan</label>
        </fieldset>
        <Field label="Hålltid (minuter)" hint="Hur länge ett erbjudet bord väntar på gästen, 5-30 minuter." required>
          <Input type="number" min={5} max={30} value={String(draft.holdMinutes)} required
            onChange={(e) => setDraft({ ...draft, holdMinutes: Number(e.target.value) })} />
        </Field>
        <Field label="Max antal i kö" hint="1-200 sällskap." required>
          <Input type="number" min={1} max={200} value={String(draft.maxWaiting)} required
            onChange={(e) => setDraft({ ...draft, maxWaiting: Number(e.target.value) })} />
        </Field>
        <Bar variant="action" label="Spara köinställningar">
          <Button type="submit" busy={saving} busyLabel="Sparar…">Spara</Button>
        </Bar>
      </form>
    </Card>
  )
}
