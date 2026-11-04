import { useEffect, useState } from 'react'
import { Bar, Button, Card, Field, Input, Select, toast } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { useTenant } from '../../shared/tenant'
import {
  deleteSegment,
  describeRules,
  listSegments,
  newId,
  previewSegment,
  saveSegment,
  draftFrom,
  rulesFrom,
  type Draft,
  type Segment,
  type SegmentTemplate,
} from './api'
import './gaster.css'

/** Målgrupper på Marknadsföring > Mottagare (ägare): sparade regler, antal och "Använd i kampanj". */
export default function SegmentsPanel() {
  const { tenant } = useTenant()
  const locations = tenant?.locations ?? []
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [templates, setTemplates] = useState<SegmentTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [counts, setCounts] = useState<Record<string, { total: number; reachable: number }>>({})

  async function load() {
    try {
      const out = await listSegments()
      setSegments(out.segments)
      setTemplates(out.templates)
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta målgrupperna.'))
    }
  }

  useEffect(() => { void load() }, [])

  async function count(segmentId: string) {
    try {
      const p = await previewSegment(segmentId)
      setCounts((c) => ({ ...c, [segmentId]: { total: p.total, reachable: p.reachable } }))
    } catch (err) {
      toast(errorText(err, 'Kunde inte räkna gästerna.'), { tone: 'danger' })
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      const saved = await saveSegment(draft.segmentId, {
        name: draft.name.trim(), rules: rulesFrom(draft), ...(draft.version ? { version: draft.version } : {}),
      })
      setDraft(null)
      await load()
      void count(saved.segmentId)
      toast('Målgruppen är sparad.', { tone: 'success' })
    } catch (err) {
      toast(errorText(err, 'Kunde inte spara målgruppen.', {
        invalid_rules: 'Kontrollera reglerna: till exempel minst 7 dagar sedan senaste besöket.',
        changed_retry: 'Målgruppen ändrades samtidigt. Ladda om sidan och försök igen.',
      }, { name: 'namnet' }), { tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function remove(segment: Segment) {
    try {
      await deleteSegment(segment.segmentId)
      await load()
    } catch (err) {
      toast(errorText(err, 'Kunde inte ta bort målgruppen.'), { tone: 'danger' })
    }
  }

  const locationName = (id: string) => locations.find((l) => l.locationId === id)?.name ?? ''
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  return (
    <Card title="Målgrupper" actions={
      <Button size="sm" variant="secondary" onClick={() => setDraft(draftFrom(newId(), '', {}))}>Ny målgrupp</Button>
    }>
      <p className="cell-muted">
        Bara gäster som har sagt ja till erbjudanden kan få utskick. Gäster som inte vill ingå räknas aldrig med.
      </p>
      {error ? <Bar variant="banner" tone="danger">{error}</Bar> : null}
      {segments && segments.length === 0 && !draft ? (
        <div className="quick-links-row">
          {templates.map((t) => (
            <Button key={t.templateId} size="sm" variant="ghost"
              onClick={() => setDraft(draftFrom(newId(), t.name, t.rules))}>
              {t.name}
            </Button>
          ))}
        </div>
      ) : null}
      {segments && segments.length > 0 ? (
        <ul className="gaster-segments">
          {segments.map((s) => (
            <li key={s.segmentId}>
              <div>
                <strong>{s.name}</strong>
                <p className="cell-muted">{describeRules(s.rules, locationName)}</p>
                {counts[s.segmentId] ? (
                  <p className="cell-muted">
                    {counts[s.segmentId].total} gäster, {counts[s.segmentId].reachable} kan få utskick
                  </p>
                ) : null}
              </div>
              <div className="row-actions">
                <Button size="sm" variant="ghost" onClick={() => void count(s.segmentId)}>Räkna</Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(draftFrom(s.segmentId, s.name, s.rules, s.version))}>Ändra</Button>
                <Button size="sm" variant="danger" onClick={() => void remove(s)}>Ta bort</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {draft ? (
        <form className="form-grid" onSubmit={save} aria-label="Målgrupp">
          <Field label="Namn" required>
            <Input value={draft.name} maxLength={60} required onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Inte varit här på (dagar)" hint="Lämna tomt för att inte använda regeln.">
            <Input type="number" min={7} max={3650} value={draft.lapsedDays} onChange={(e) => set({ lapsedDays: e.target.value })} />
          </Field>
          <Field label="Fyller år inom (dagar)">
            <Input type="number" min={1} max={60} value={draft.birthdayWithinDays} onChange={(e) => set({ birthdayWithinDays: e.target.value })} />
          </Field>
          <Field label="Handlat för minst (kr)">
            <Input type="number" min={1} value={draft.minSpendSek} onChange={(e) => set({ minSpendSek: e.target.value })} />
          </Field>
          <Field label="Minst antal besök">
            <Input type="number" min={1} max={1000} value={draft.minVisits} onChange={(e) => set({ minVisits: e.target.value })} />
          </Field>
          {locations.length > 1 ? (
            <Field label="Restaurang">
              <Select value={draft.locationId} onChange={(e) => set({ locationId: e.target.value })}>
                <option value="">Alla</option>
                {locations.map((l) => <option key={l.locationId} value={l.locationId}>{l.name ?? l.locationId}</option>)}
              </Select>
            </Field>
          ) : null}
          <label className="toggle-row">
            <input type="checkbox" className="switch" checked={draft.optedIn} onChange={(e) => set({ optedIn: e.target.checked })} />
            <span className="toggle-row-label">Vill ha erbjudanden</span>
          </label>
          <Bar variant="action" label="Spara målgrupp">
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Avbryt</Button>
            <Button type="submit" busy={saving} busyLabel="Sparar…"
              disabled={!draft.name.trim() || Object.keys(rulesFrom(draft)).length === 0}>
              Spara
            </Button>
          </Bar>
        </form>
      ) : null}
    </Card>
  )
}
