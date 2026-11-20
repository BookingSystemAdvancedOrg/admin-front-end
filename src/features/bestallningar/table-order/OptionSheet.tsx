import { useState } from 'react'
import { Bar, Button, Modal } from '@booqy/brand'
import { kronor } from '../ordersApi'
import type { TabMenuItem, TabOption } from './types'

/** The chosen options are complete: every required group has a choice. */
export function optionsComplete(item: TabMenuItem, options: TabOption[]): boolean {
  return item.options.every((g) => !g.required || g.choices.length === 0 || options.some((o) => o.group === g.name))
}

/** Choice chips per option group (one choice, or up to maxChoices). */
export function OptionGroups({
  item,
  value,
  onChange,
}: {
  item: TabMenuItem
  value: TabOption[]
  onChange: (next: TabOption[]) => void
}) {
  if (item.options.length === 0) return null
  return (
    <div className="to-option-groups">
      {item.options.map((g) => {
        const chosen = value.filter((o) => o.group === g.name)
        const single = g.maxChoices <= 1
        const missing = g.required && chosen.length === 0
        return (
          <fieldset key={g.name} className={`to-option-group${missing ? ' is-missing' : ''}`}>
            <legend>
              {g.name}
              {g.required && <span className="to-required"> (välj)</span>}
            </legend>
            <div className="to-chips">
              {g.choices.map((c) => {
                const on = chosen.some((o) => o.choice === c.name)
                return (
                  <button
                    key={c.name}
                    type="button"
                    className={`to-chip-btn${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => {
                      const others = value.filter((o) => o.group !== g.name)
                      if (on) {
                        onChange(single && g.required ? value : value.filter((o) => !(o.group === g.name && o.choice === c.name)))
                      } else if (single) {
                        onChange([...others, { group: g.name, choice: c.name }])
                      } else if (chosen.length < g.maxChoices) {
                        onChange([...value, { group: g.name, choice: c.name }])
                      }
                    }}
                  >
                    {c.name}
                    {c.price > 0 && <span className="to-chip-price"> +{kronor(c.price)}</span>}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}

/**
 * A dish with a required choice (Stekgrad) asks for it before it lands in
 * the order: one tap per choice, then Lägg till.
 */
export function OptionSheet({
  item,
  onAdd,
  onClose,
}: {
  item: TabMenuItem
  onAdd: (options: TabOption[]) => void
  onClose: () => void
}) {
  const [options, setOptions] = useState<TabOption[]>([])
  const ready = optionsComplete(item, options)
  return (
    <Modal
      open
      title={item.name}
      onClose={onClose}
      closeLabel="Stäng"
      footer={
        <Bar variant="action" label={`Lägg till ${item.name}`}>
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button disabled={!ready} onClick={() => onAdd(options)}>Lägg till</Button>
        </Bar>
      }
    >
      <OptionGroups item={item} value={options} onChange={setOptions} />
    </Modal>
  )
}
