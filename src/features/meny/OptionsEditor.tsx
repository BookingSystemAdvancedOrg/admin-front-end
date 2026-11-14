import { Icon } from '../../shared/Icon'
import { MAX_CHOICES, MAX_GROUPS, NAME_MAX } from './menuForm'
import type { DraftGroup } from './menuForm'
import { parsePrice } from './menuApi'

/**
 * Tillval för en rätt: grupper som Storlek (krävs, ett val) eller Extra
 * (frivilligt, flera val), varje val med ett pristillägg. Gästen väljer
 * dem vid beställning; servern lägger på priset.
 */
export function OptionsEditor({ value, onChange }: { value: DraftGroup[]; onChange: (next: DraftGroup[]) => void }) {
  const setGroup = (i: number, patch: Partial<DraftGroup>) =>
    onChange(value.map((g, k) => (k === i ? { ...g, ...patch } : g)))
  const setChoice = (i: number, j: number, patch: Partial<{ name: string; price: string }>) =>
    setGroup(i, { choices: value[i].choices.map((c, k) => (k === j ? { ...c, ...patch } : c)) })

  return (
    <fieldset className="dish-options">
      <legend>Tillval</legend>
      <p className="cell-muted dish-options-hint">
        Till exempel Storlek (krävs, ett val) eller Extra (frivilligt). Priset läggs på rättens pris när gästen väljer.
      </p>
      {value.map((g, i) => (
        <div key={i} className="dish-option-group">
          <div className="dish-option-head">
            <div className="form-field">
              <label htmlFor={`opt-group-${i}`}>Grupp {i + 1}</label>
              <input id={`opt-group-${i}`} value={g.name} maxLength={NAME_MAX} placeholder="Till exempel Storlek"
                onChange={(e) => setGroup(i, { name: e.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor={`opt-max-${i}`}>Gästen väljer</label>
              <select id={`opt-max-${i}`} value={Math.min(g.maxChoices, Math.max(1, g.choices.length))}
                onChange={(e) => setGroup(i, { maxChoices: Number(e.target.value) })}>
                {Array.from({ length: Math.max(1, g.choices.length) }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>{n === 1 ? 'Ett val' : `Upp till ${n}`}</option>
                ))}
              </select>
            </div>
            <label className="meny-check dish-option-required">
              <input type="checkbox" checked={g.required} onChange={(e) => setGroup(i, { required: e.target.checked })} />
              Krävs
            </label>
            <button type="button" className="btn outline square meny-icon-btn dish-option-remove" aria-label={`Ta bort grupp ${i + 1}`}
              title="Ta bort gruppen" onClick={() => onChange(value.filter((_, k) => k !== i))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
          {g.choices.map((c, j) => (
            <div key={j} className="dish-option-choice">
              <div className="form-field">
                <label htmlFor={`opt-${i}-${j}`} className="sr-only">Grupp {i + 1}, val {j + 1}</label>
                <input id={`opt-${i}-${j}`} value={c.name} maxLength={NAME_MAX}
                  placeholder={j === 0 ? 'Till exempel Stor' : 'Val'}
                  onChange={(e) => setChoice(i, j, { name: e.target.value })} />
              </div>
              <div className="form-field dish-option-price">
                <label htmlFor={`opt-price-${i}-${j}`} className="sr-only">Pristillägg för val {j + 1} (kr)</label>
                <input id={`opt-price-${i}-${j}`} inputMode="decimal" value={c.price} placeholder="+0 kr"
                  aria-invalid={c.price.trim() !== '' && parsePrice(c.price).error !== null ? true : undefined}
                  onChange={(e) => setChoice(i, j, { price: e.target.value })} />
              </div>
              <button type="button" className="btn outline square meny-icon-btn" aria-label={`Ta bort val ${j + 1} i grupp ${i + 1}`}
                title="Ta bort valet"
                onClick={() => setGroup(i, { choices: g.choices.filter((_, k) => k !== j) })}>
                <Icon name="minus" size={16} />
              </button>
            </div>
          ))}
          {g.choices.length < MAX_CHOICES && (
            <button type="button" className="btn outline square dish-option-add"
              onClick={() => setGroup(i, { choices: [...g.choices, { name: '', price: '' }] })}>
              <Icon name="plus" size={14} /> Lägg till val
            </button>
          )}
        </div>
      ))}
      {value.length < MAX_GROUPS && (
        <button type="button" className="btn outline square dish-option-add"
          onClick={() => onChange([...value, { name: '', required: false, maxChoices: 1, choices: [{ name: '', price: '' }] }])}>
          <Icon name="plus" size={14} /> {value.length ? 'Lägg till grupp' : 'Lägg till tillval'}
        </button>
      )}
    </fieldset>
  )
}
