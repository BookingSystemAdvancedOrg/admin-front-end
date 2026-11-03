import { useEffect, useMemo, useState } from 'react'
import { Bar, Button, Field, Input, Modal, Select } from '@booqy/brand'
import { errorText } from '../../shared/errors'
import { listMenuItems, menuImageUrl, type MenuItem } from '../meny/menuApi'
import { ERRORS, GOALS, createCampaign, newCampaignId, suggestCopy, type Goal } from './api'

const STEPS = ['Mål', 'Bild och text', 'Budget', 'Område', 'Förhandsvisning', 'Skapa'] as const
const MAX_HEADLINE = 40
const MAX_TEXT = 125

/** "Ny annons": sex steg. Annonsen skapas pausad; "Starta annonsen" startar den. */
export default function AdWizard({ locationId, onClose, onCreated }: {
  locationId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState<Goal>('bookings')
  const [dishes, setDishes] = useState<MenuItem[]>([])
  const [menuItemId, setMenuItemId] = useState('')
  const [headline, setHeadline] = useState('')
  const [primaryText, setPrimaryText] = useState('')
  const [suggestions, setSuggestions] = useState<{ headline: string; primaryText: string }[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [budget, setBudget] = useState('500')
  const [days, setDays] = useState('7')
  const [radius, setRadius] = useState('5')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // One id for the whole wizard: pressing Skapa twice makes one campaign.
  const [campaignId] = useState(newCampaignId)

  useEffect(() => {
    listMenuItems(locationId)
      .then((items) => setDishes(items.filter((i) => i.active && i.imageKey && !i.alcohol)))
      .catch(() => setDishes([]))
  }, [locationId])

  const dish = useMemo(() => dishes.find((d) => d.menuItemId === menuItemId) ?? null, [dishes, menuItemId])
  const image = dish ? menuImageUrl(dish.imageKey) : null

  async function suggest() {
    if (!menuItemId) return
    setSuggesting(true)
    setError(null)
    try {
      setSuggestions((await suggestCopy(locationId, menuItemId, goal)).suggestions)
    } catch (err) {
      setError(errorText(err, 'Inga förslag just nu.', ERRORS))
    } finally {
      setSuggesting(false)
    }
  }

  const valid = [
    true,
    Boolean(menuItemId && headline.trim() && primaryText.trim() && headline.length <= MAX_HEADLINE && primaryText.length <= MAX_TEXT),
    Number(budget) >= 100 && Number(budget) <= 20000 && Number(days) >= 3 && Number(days) <= 30,
    Number(radius) >= 1 && Number(radius) <= 40,
    true,
    true,
  ]

  async function create() {
    setCreating(true)
    setError(null)
    try {
      await createCampaign(locationId, {
        campaignId, goal, menuItemId, headline: headline.trim(), primaryText: primaryText.trim(),
        budgetSek: Number(budget), days: Number(days), radiusKm: Number(radius),
      })
      onCreated()
    } catch (err) {
      setError(errorText(err, 'Annonsen kunde inte skapas.', ERRORS, { headline: 'rubriken', primaryText: 'texten' }))
    } finally {
      setCreating(false)
    }
  }

  const last = step === STEPS.length - 1
  return (
    <Modal open size="wide" title="Ny annons" onClose={onClose} closeLabel="Stäng" footer={
      <>
        {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Tillbaka</Button> : null}
        {last ? (
          <Button busy={creating} busyLabel="Skapar…" onClick={create}>Skapa annonsen</Button>
        ) : (
          <Button disabled={!valid[step]} onClick={() => setStep(step + 1)}>Nästa</Button>
        )}
      </>
    }>
      <Bar variant="progress" value={(step + 1) / STEPS.length} label="Steg" valueText={`${step + 1} av ${STEPS.length}: ${STEPS[step]}`} />
      {error ? <Bar variant="banner" tone="danger">{error}</Bar> : null}

      {step === 0 ? (
        <fieldset className="toggle-stack">
          <legend className="form-section-label">Vad ska annonsen ge?</legend>
          {GOALS.map((g) => (
            <label key={g.id} className="toggle-row">
              <input type="radio" name="goal" value={g.id} checked={goal === g.id} onChange={() => setGoal(g.id)} />
              <span className="toggle-row-label"><strong>{g.label}</strong> <span className="cell-muted">{g.text}</span></span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {step === 1 ? (
        <div className="form-grid">
          <Field label="Rätt" hint={dishes.length === 0 ? 'Lägg till en bild på en rätt under Meny först. Rätter med alkohol kan inte annonseras.' : undefined} required>
            <Select value={menuItemId} onChange={(e) => { setMenuItemId(e.target.value); setSuggestions([]) }}>
              <option value="">Välj rätt</option>
              {dishes.map((d) => <option key={d.menuItemId} value={d.menuItemId}>{d.name}</option>)}
            </Select>
          </Field>
          <div className="row-actions">
            <Button variant="secondary" size="sm" disabled={!menuItemId} busy={suggesting} busyLabel="Skriver förslag…" onClick={suggest}>
              Föreslå text
            </Button>
          </div>
          {suggestions.length ? (
            <fieldset className="toggle-stack">
              <legend className="form-section-label">Förslag (du kan ändra texten efteråt)</legend>
              {suggestions.map((s, i) => (
                <Button key={i} variant="ghost" onClick={() => { setHeadline(s.headline); setPrimaryText(s.primaryText) }}>
                  {s.headline}: {s.primaryText}
                </Button>
              ))}
            </fieldset>
          ) : null}
          <Field label="Rubrik" hint={`${headline.length} av ${MAX_HEADLINE} tecken`} required>
            <Input value={headline} maxLength={MAX_HEADLINE} onChange={(e) => setHeadline(e.target.value)} />
          </Field>
          <Field label="Text" hint={`${primaryText.length} av ${MAX_TEXT} tecken. Priser ska anges med moms.`} required>
            <textarea className="bq-input" maxLength={MAX_TEXT} value={primaryText} onChange={(e) => setPrimaryText(e.target.value)} />
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="form-grid">
          <Field label="Total budget (kr)" hint="100-20 000 kr. Meta slutar visa annonsen när budgeten är slut." required>
            <Input type="number" min={100} max={20000} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field label="Antal dagar" hint="3-30 dagar. Annonsen slutar av sig själv." required>
            <Input type="number" min={3} max={30} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="form-grid">
          <Field label="Område runt restaurangen (km)" hint="1-40 km. Annonsen visas för personer över 18 år i området." required>
            <Input type="number" min={1} max={40} value={radius} onChange={(e) => setRadius(e.target.value)} />
          </Field>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="quick-links-row" aria-label="Förhandsvisning">
          {(['Flöde', 'Story'] as const).map((frame) => (
            <figure key={frame} className="admin-card">
              <figcaption className="form-section-label">{frame}</figcaption>
              {image ? <img src={image} alt={dish?.name ?? ''} className="dish-swatch" /> : null}
              <p><strong>{headline}</strong></p>
              <p>{primaryText}</p>
              <span className="status-badge">{GOALS.find((g) => g.id === goal)?.label}</span>
            </figure>
          ))}
        </div>
      ) : null}

      {step === 5 ? (
        <div>
          <p>
            Annonsen skapas hos Meta och blir <strong>pausad</strong>. Den visas först när du trycker på
            "Starta annonsen" i listan.
          </p>
          <dl className="booking-meta">
            <dt>Rätt</dt><dd>{dish?.name}</dd>
            <dt>Budget</dt><dd>{Number(budget).toLocaleString('sv-SE')} kr under {days} dagar</dd>
            <dt>Område</dt><dd>{radius} km runt restaurangen</dd>
          </dl>
        </div>
      ) : null}
    </Modal>
  )
}
