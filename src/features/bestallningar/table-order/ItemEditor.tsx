import { useState } from 'react'
import { Bar, Button, Modal } from '@booqy/brand'
import { Icon } from '../../../shared/Icon'
import { kronor } from '../ordersApi'
import { MAX_QTY, NOTE_MAX, unitPriceOf } from './cart'
import type { CartLine, LineExtra } from './cart'
import { COURSE_LABEL, COURSE_ORDER } from './courses'
import { OptionGroups, optionsComplete } from './OptionSheet'
import type { Course, TabMenuItem, TabOption } from './types'

/** Quick notes the kitchen hears every night; one tap adds or removes them. */
export const NOTE_CHIPS = ['Utan lök', 'Glutenfri', 'Laktosfri', 'Extra sås'] as const

function toggleNote(note: string, chip: string): string {
  const parts = note.split(',').map((p) => p.trim()).filter(Boolean)
  const has = parts.some((p) => p.toLowerCase() === chip.toLowerCase())
  const next = has ? parts.filter((p) => p.toLowerCase() !== chip.toLowerCase()) : [...parts, chip]
  return next.join(', ').slice(0, NOTE_MAX)
}

/**
 * Everything about one line: options, a note for the kitchen (quick chips
 * plus free text), the allergy flag (an allergy ticket of its own), which
 * course it is served as, and how many.
 */
export function ItemEditor({
  item,
  line,
  onSave,
  onClose,
}: {
  item: TabMenuItem
  /** the line being edited; null = a new line */
  line: CartLine | null
  onSave: (extra: LineExtra & { quantity: number; course: Course }) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<TabOption[]>(line?.options ?? [])
  const [note, setNote] = useState(line?.note ?? '')
  const [allergy, setAllergy] = useState(Boolean(line?.allergy))
  const [course, setCourse] = useState<Course>(line?.course ?? item.course)
  const [quantity, setQuantity] = useState(line?.quantity ?? 1)
  const ready = optionsComplete(item, options)
  const price = unitPriceOf(item, options) * quantity

  return (
    <Modal
      open
      title={item.name}
      onClose={onClose}
      closeLabel="Stäng"
      footer={
        <Bar variant="action" label={line ? `Spara ${item.name}` : `Lägg till ${item.name}`} status={kronor(price)}>
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button
            disabled={!ready}
            onClick={() => onSave({ options, note: note.trim(), allergy, course, quantity })}
          >
            {line ? 'Spara' : 'Lägg till'}
          </Button>
        </Bar>
      }
    >
      <div className="to-editor">
        <div className="to-editor-qty">
          <span className="to-label" id="to-editor-qty">Antal</span>
          <div className="to-stepper" role="group" aria-labelledby="to-editor-qty">
            <button type="button" aria-label="En mindre" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              <Icon name="minus" size={18} />
            </button>
            <output aria-live="polite">{quantity}</output>
            <button type="button" aria-label="En till" disabled={quantity >= MAX_QTY} onClick={() => setQuantity((q) => Math.min(MAX_QTY, q + 1))}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </div>

        <OptionGroups item={item} value={options} onChange={setOptions} />

        <fieldset className="to-option-group">
          <legend>Till köket</legend>
          <div className="to-chips">
            {NOTE_CHIPS.map((chip) => {
              const on = note.split(',').some((p) => p.trim().toLowerCase() === chip.toLowerCase())
              return (
                <button key={chip} type="button" className={`to-chip-btn${on ? ' is-on' : ''}`} aria-pressed={on}
                  onClick={() => setNote((n) => toggleNote(n, chip))}>
                  {chip}
                </button>
              )
            })}
            <button type="button" className={`to-chip-btn to-chip-btn--allergy${allergy ? ' is-on' : ''}`} aria-pressed={allergy}
              onClick={() => setAllergy((a) => !a)}>
              Allergi
            </button>
          </div>
          <label className="to-note">
            <span className="sr-only">Notering till köket</span>
            <textarea
              value={note}
              maxLength={NOTE_MAX}
              rows={2}
              placeholder={allergy ? 'Vilken allergi?' : 'Notering'}
              onChange={(e) => setNote(e.target.value)}
            />
            <span className="to-note-count cell-muted" aria-hidden="true">{note.length}/{NOTE_MAX}</span>
          </label>
        </fieldset>

        <fieldset className="to-option-group">
          <legend>Serveras som</legend>
          <div className="to-chips">
            {COURSE_ORDER.map((c) => (
              <button key={c} type="button" className={`to-chip-btn${course === c ? ' is-on' : ''}`} aria-pressed={course === c}
                onClick={() => setCourse(c)}>
                {COURSE_LABEL[c]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  )
}
