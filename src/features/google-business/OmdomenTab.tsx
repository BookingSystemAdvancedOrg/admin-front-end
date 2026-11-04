import { useCallback, useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, StatTile, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { currentLocation, useTenant } from '../../shared/tenant'
import {
  ERRORS,
  getConnection,
  getLocationView,
  saveReviewSettings,
  type Channel,
  type LocationView,
  type ReviewSettings,
  type Source,
} from './api'
import './google.css'

const SOURCES: { id: Source; label: string }[] = [
  { id: 'booking', label: 'Efter bordsbokning (när gästen har kommit)' },
  { id: 'order', label: 'Efter beställning (när den är klar)' },
]
const CHANNELS: { id: Channel; label: string }[] = [
  { id: 'email', label: 'E-post' },
  { id: 'sms', label: 'SMS' },
]

/** Marknadsföring > Omdömen: be gäster om ett omdöme på Google efter besöket. */
export default function OmdomenTab() {
  const location = currentLocation(useTenant())
  const locationId = location?.locationId
  const [view, setView] = useState<LocationView | null>(null)
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState<ReviewSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!locationId) return
    try {
      const [c, v] = await Promise.all([getConnection(), getLocationView(locationId)])
      setConnected(c.status === 'connected')
      setView(v)
      setDraft(v.reviewSettings)
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta omdömesinställningarna.', ERRORS))
    }
  }, [locationId])

  useEffect(() => { void load() }, [load])

  if (error) return <Bar variant="banner" tone="danger" onDismiss={() => setError(null)} dismissLabel="Stäng">{error}</Bar>
  if (!locationId || !view || !draft) return <p className="cell-muted">Hämtar…</p>

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft || !locationId) return
    setSaving(true)
    try {
      const saved = await saveReviewSettings(locationId, draft)
      setDraft(saved)
      toast('Sparat.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara.', ERRORS), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const hours = Math.round(draft.delayMinutes / 60)
  return (
    <>
      {!connected || !view.link ? (
        <Bar variant="banner" tone="warning">
          Koppla er Google-profil under Inställningar &gt; Profil först, annars vet vi inte vart gästen ska skriva omdömet.
        </Bar>
      ) : null}
      <div className="omdomen-stats">
        <StatTile label="Skickade (30 dagar)" value={String(view.stats.sent30d)} index={0} />
        <StatTile label="Inte skickade (30 dagar)" value={String(view.stats.skipped30d)}
          note="Saknat samtycke, nyligen frågad eller utebliven gäst." index={1} />
      </div>
      <Card title="Be om omdömen på Google">
        <p>
          Gäster som har sagt ja till utskick från er får ett meddelande efter besöket med en länk till ert
          Google-omdöme. Alla får samma meddelande, utan frågor om betyg och utan erbjudanden, och kan avregistrera
          sig med ett klick.
        </p>
        <form className="form-grid" onSubmit={save} aria-label="Omdömesförfrågningar">
          <fieldset className="omdomen-checks">
            <legend>Skicka förfrågningar</legend>
            <label>
              <input type="checkbox" checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              På
            </label>
          </fieldset>
          <fieldset className="omdomen-checks">
            <legend>När</legend>
            {SOURCES.map((s) => (
              <label key={s.id}>
                <input type="checkbox" checked={draft.sources.includes(s.id)}
                  onChange={() => setDraft({ ...draft, sources: toggle(draft.sources, s.id) })} />
                {s.label}
              </label>
            ))}
          </fieldset>
          <fieldset className="omdomen-checks">
            <legend>Hur</legend>
            {CHANNELS.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={draft.channels.includes(c.id)}
                  onChange={() => setDraft({ ...draft, channels: toggle(draft.channels, c.id) })} />
                {c.label}
              </label>
            ))}
          </fieldset>
          <Field label="Fördröjning (timmar)" hint="Hur länge efter besöket meddelandet skickas, 1-72 timmar." required>
            <Input type="number" min={1} max={72} value={String(hours)} required
              onChange={(e) => setDraft({ ...draft, delayMinutes: Math.max(30, Number(e.target.value) * 60) })} />
          </Field>
          <Field label="Högst en gång per (dagar)" hint="Samma gäst frågas inte oftare än så, 30-365 dagar." required>
            <Input type="number" min={30} max={365} value={String(draft.minDaysBetween)} required
              onChange={(e) => setDraft({ ...draft, minDaysBetween: Number(e.target.value) })} />
          </Field>
          <Bar variant="action" label="Spara omdömesinställningar">
            <Button type="submit" busy={saving} busyLabel="Sparar…" disabled={!draft.channels.length}>Spara</Button>
          </Bar>
        </form>
      </Card>
    </>
  )
}
