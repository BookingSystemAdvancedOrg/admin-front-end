import { useEffect, useRef, useState } from 'react'
import { listMenuItems } from '../meny/menuApi'
import type { MenuItem } from '../meny/menuApi'
import { useTenant } from '../../shared/tenant'
import {
  BLOCK_LABEL,
  DESTINATION_LABEL,
  MAX_BLOCKS,
  errorText,
  newBlock,
  previewTemplate,
  templateErrors,
  THEME_BACKGROUNDS,
  THEME_COLORS,
} from './marketingApi'
import type { Block, BlockType, Destination, TemplateInput, TemplateTheme } from './marketingApi'
import { Icon } from '../../shared/Icon'

const ADDABLE: BlockType[] = ['heading', 'text', 'button', 'image', 'dish', 'divider', 'spacer']
const PREVIEW_DELAY_MS = 600

function BlockFields({
  block,
  index,
  dishes,
  onChange,
}: {
  block: Block
  index: number
  dishes: MenuItem[] | null
  onChange: (b: Block) => void
}) {
  const id = (f: string) => `mk-b${index}-${f}`
  switch (block.type) {
    case 'heading':
      return (
        <div className="form-field">
          <label htmlFor={id('text')}>Rubrik</label>
          <input id={id('text')} value={block.text} maxLength={120} onChange={(e) => onChange({ ...block, text: e.target.value })} />
        </div>
      )
    case 'text':
      return (
        <div className="form-field">
          <label htmlFor={id('text')}>Text</label>
          <textarea id={id('text')} rows={5} value={block.text} maxLength={2000} onChange={(e) => onChange({ ...block, text: e.target.value })} />
          <p className="field-hint">{'{förnamn}'} och {'{restaurang}'} byts mot gästens förnamn och restaurangens namn.</p>
        </div>
      )
    case 'image':
      return (
        <div className="mk-fields">
          <div className="form-field">
            <label htmlFor={id('url')}>Bildadress (https://)</label>
            <input id={id('url')} value={block.url} placeholder="https://" onChange={(e) => onChange({ ...block, url: e.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor={id('alt')}>Beskrivning av bilden</label>
            <input id={id('alt')} value={block.alt ?? ''} maxLength={160} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
          </div>
        </div>
      )
    case 'button':
      return (
        <div className="mk-fields">
          <div className="form-field">
            <label htmlFor={id('label')}>Knapptext</label>
            <input id={id('label')} value={block.label} maxLength={40} onChange={(e) => onChange({ ...block, label: e.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor={id('dest')}>Leder till</label>
            <select
              id={id('dest')}
              value={block.destination}
              onChange={(e) => onChange({ ...block, destination: e.target.value as Destination })}
            >
              {(Object.keys(DESTINATION_LABEL) as Destination[]).map((d) => (
                <option key={d} value={d}>{DESTINATION_LABEL[d]}</option>
              ))}
            </select>
          </div>
          {block.destination === 'custom' && (
            <div className="form-field">
              <label htmlFor={id('url')}>Länk (https://)</label>
              <input id={id('url')} value={block.url ?? ''} placeholder="https://" onChange={(e) => onChange({ ...block, url: e.target.value })} />
            </div>
          )}
        </div>
      )
    case 'dish':
      return (
        <div className="form-field">
          <label htmlFor={id('dish')}>Rätt</label>
          <select
            id={id('dish')}
            value={block.menuItemId}
            disabled={!dishes}
            onChange={(e) => onChange({ ...block, menuItemId: e.target.value })}
          >
            <option value="">{dishes ? 'Välj en rätt' : 'Hämtar menyn…'}</option>
            {(dishes ?? []).map((d) => (
              <option key={d.menuItemId} value={d.menuItemId}>
                {d.name}{d.active ? '' : ' (inaktiv)'}
              </option>
            ))}
          </select>
          <p className="field-hint">Namn, bild och pris hämtas från menyn när utskicket skickas.</p>
        </div>
      )
    case 'spacer':
      return (
        <div className="form-field">
          <label htmlFor={id('size')}>Storlek</label>
          <select id={id('size')} value={block.size} onChange={(e) => onChange({ ...block, size: e.target.value as 's' | 'm' | 'l' })}>
            <option value="s">Liten</option>
            <option value="m">Mellan</option>
            <option value="l">Stor</option>
          </select>
        </div>
      )
    case 'divider':
      return <p className="cell-muted">En tunn linje mellan delarna.</p>
  }
}

/**
 * Mallredigeraren: fält till vänster, förhandsvisning till höger (servern
 * ritar mejlet exakt som det skickas, med "Anna" som exempelgäst). Ingenting
 * sparas förrän ägaren trycker Spara.
 */
export function TemplateEditor({
  initial,
  title,
  saving,
  onSave,
  onCancel,
}: {
  initial: TemplateInput
  title: string
  saving: boolean
  onSave: (t: TemplateInput) => void
  onCancel: () => void
}) {
  const { locationId } = useTenant()
  const [draft, setDraft] = useState<TemplateInput>(initial)
  const [dishes, setDishes] = useState<MenuItem[] | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [addType, setAddType] = useState<BlockType>('text')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errors = templateErrors(draft)

  useEffect(() => {
    if (!locationId || !draft.blocks.some((b) => b.type === 'dish')) return
    if (dishes) return
    let cancelled = false
    listMenuItems(locationId)
      .then((items) => !cancelled && setDishes(items.sort((a, b) => a.name.localeCompare(b.name, 'sv'))))
      .catch(() => !cancelled && setDishes([]))
    return () => {
      cancelled = true
    }
  }, [locationId, draft.blocks, dishes])

  // Förhandsvisningen uppdateras en stund efter att ägaren slutat skriva.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (templateErrors(draft).length > 0) return
    let cancelled = false
    timer.current = setTimeout(() => {
      previewTemplate(draft)
        .then((p) => {
          if (cancelled) return
          setPreview(p)
          setPreviewError(null)
        })
        .catch((err: unknown) => !cancelled && setPreviewError(errorText(err, 'Kunde inte visa förhandsvisningen.')))
    }, PREVIEW_DELAY_MS)
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [draft])

  const setBlock = (i: number, b: Block) =>
    setDraft((d) => ({ ...d, blocks: d.blocks.map((x, j) => (j === i ? b : x)) }))
  const move = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      const j = i + by
      if (j < 0 || j >= d.blocks.length) return d
      const blocks = [...d.blocks]
      ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
      return { ...d, blocks }
    })
  const remove = (i: number) => setDraft((d) => ({ ...d, blocks: d.blocks.filter((_, j) => j !== i) }))
  const add = () =>
    setDraft((d) => (d.blocks.length >= MAX_BLOCKS ? d : { ...d, blocks: [...d.blocks, newBlock(addType, locationId)] }))

  const save = () => {
    if (errors.length > 0) {
      setShowErrors(true)
      return
    }
    onSave(draft)
  }

  return (
    <section className="admin-card table-card mk-editor" aria-label={title}>
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        <div className="row-actions">
          <button type="button" className="btn outline square" onClick={onCancel} disabled={saving}>
            Avbryt
          </button>
          <button type="button" className="btn primary square" onClick={save} disabled={saving}>
            {saving ? 'Sparar…' : 'Spara mallen'}
          </button>
        </div>
      </div>

      <div className="mk-editor-grid">
        <div className="mk-editor-form">
          <div className="form-field">
            <label htmlFor="mk-tpl-name">Mallens namn (syns bara för er)</label>
            <input id="mk-tpl-name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor="mk-tpl-subject">Ämnesrad</label>
            <input id="mk-tpl-subject" value={draft.subject} maxLength={120} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <div className="form-field">
            <label htmlFor="mk-tpl-pre">Förhandstext (visas efter ämnet i inkorgen)</label>
            <input id="mk-tpl-pre" value={draft.preheader} maxLength={140} onChange={(e) => setDraft({ ...draft, preheader: e.target.value })} />
          </div>

          <ThemePicker theme={draft.theme ?? null} onChange={(theme) => setDraft({ ...draft, theme })} />

          <p className="form-section-label">Innehåll</p>
          <ol className="mk-blocks">
            {draft.blocks.map((b, i) => (
              <li key={i} className="mk-block">
                <div className="mk-block-head">
                  <span className="mk-block-type">{BLOCK_LABEL[b.type]}</span>
                  <span className="mk-block-tools">
                    <button type="button" className="mk-icon-btn" aria-label={`Flytta block ${i + 1} upp`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow-up" size={16} /></button>
                    <button type="button" className="mk-icon-btn" aria-label={`Flytta block ${i + 1} ned`} disabled={i === draft.blocks.length - 1} onClick={() => move(i, 1)}><Icon name="arrow-down" size={16} /></button>
                    <button type="button" className="mk-icon-btn danger" aria-label={`Ta bort block ${i + 1}`} onClick={() => remove(i)}><Icon name="close" size={16} /></button>
                  </span>
                </div>
                <BlockFields block={b} index={i} dishes={dishes} onChange={(nb) => setBlock(i, nb)} />
              </li>
            ))}
          </ol>
          <div className="mk-add">
            <select className="compact-select" aria-label="Typ av block" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
              {ADDABLE.map((t) => (
                <option key={t} value={t}>{BLOCK_LABEL[t]}</option>
              ))}
            </select>
            <button type="button" className="btn outline square" onClick={add} disabled={draft.blocks.length >= MAX_BLOCKS}>
              Lägg till block
            </button>
          </div>

          {showErrors && errors.length > 0 && (
            <ul className="form-error mk-errors" role="alert">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <div className="mk-preview">
          <p className="form-section-label">Förhandsvisning</p>
          {preview ? (
            <>
              <p className="mk-preview-subject"><span className="cell-muted">Ämne:</span> {preview.subject}</p>
              <iframe
                className="mk-preview-frame"
                title="Förhandsvisning av mejlet"
                sandbox=""
                srcDoc={preview.html}
              />
            </>
          ) : (
            <p className="cell-muted">
              {previewError ?? (errors.length > 0 ? 'Fyll i det som saknas, så visas mejlet här.' : 'Ritar mejlet…')}
            </p>
          )}
          {preview && previewError && <p className="field-hint error" role="alert">{previewError}</p>}
          <p className="field-hint">
            Varje utskick får automatiskt restaurangens namn och logga, adress och en länk för att avsluta
            prenumerationen.
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * Mejlets färger: huvudfärgen (sidhuvudet och knapparna) och bakgrunden runt
 * mejlet. Färdiga färger att trycka på, och "Egen färg" för en helt egen.
 * Förhandsvisningen bredvid visar resultatet direkt.
 */
export function ThemePicker({ theme, onChange }: { theme: TemplateTheme | null; onChange: (t: TemplateTheme | null) => void }) {
  const color = theme?.color ?? null
  const background = theme?.background ?? null
  const set = (next: TemplateTheme) => {
    const merged = { color, background, ...next }
    onChange(merged.color || merged.background ? merged : null)
  }
  return (
    <fieldset className="mk-theme">
      <legend className="form-section-label">Färger</legend>
      <SwatchRow
        label="Huvudfärg"
        hint="Sidhuvudet och knapparna i mejlet. Texten på färgen blir ljus eller mörk av sig själv så att den går att läsa."
        options={THEME_COLORS}
        value={color}
        fallback="#1f2a24"
        onPick={(v) => set({ color: v })}
      />
      <SwatchRow
        label="Bakgrund"
        hint="Färgen runt själva mejlet."
        options={THEME_BACKGROUNDS}
        value={background}
        fallback="#f4f2ee"
        onPick={(v) => set({ background: v })}
      />
    </fieldset>
  )
}

function SwatchRow({ label, hint, options, value, fallback, onPick }: {
  label: string
  hint: string
  options: { label: string; value: string | null }[]
  value: string | null
  fallback: string
  onPick: (v: string | null) => void
}) {
  const custom = value !== null && !options.some((o) => o.value === value)
  return (
    <div className="mk-theme-row">
      <p className="mk-theme-label">{label}</p>
      <p className="mk-theme-hint">{hint}</p>
      <div className="mk-swatches" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'mk-swatch on' : 'mk-swatch'}
            title={o.label}
            onClick={() => onPick(o.value)}
          >
            <span
              className={o.value === null ? 'mk-swatch-dot auto' : 'mk-swatch-dot'}
              style={{ background: o.value ?? fallback }}
              aria-hidden="true"
            />
            <span className="mk-swatch-name">{o.label}</span>
          </button>
        ))}
        <label className={custom ? 'mk-swatch on' : 'mk-swatch'} title="Egen färg">
          <span className="mk-swatch-dot custom" style={custom ? { background: value ?? undefined } : undefined} aria-hidden="true" />
          <span className="mk-swatch-name">Egen färg</span>
          <input
            type="color"
            className="mk-swatch-input"
            value={custom && value ? value : fallback}
            aria-label={`${label}: egen färg`}
            onChange={(e) => onPick(e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
