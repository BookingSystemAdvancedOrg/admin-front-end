import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { placeList, type Place } from './selectPlace'
import './select.css'

/**
 * Rullistan i hela adminen: en knapp med det valda värdet och en lista i
 * Booqys glas (aldrig systemets grå meny). Mönstret är WAI-ARIA:s
 * "select-only combobox": fokus stannar på knappen, raden man står på pekas
 * ut med aria-activedescendant.
 *
 * Används som <select>: barnen är <option> och <optgroup>, value och
 * onChange(e) med e.target.value fungerar som förut. Listan ritas i <body>,
 * under knappen (ovanför om det inte får plats). På telefon kommer den upp
 * som ett ark nerifrån med stora rader.
 */

export type SelectChangeEvent = {
  target: { value: string; name?: string }
  currentTarget: { value: string; name?: string }
}

export type SelectProps = {
  id?: string
  name?: string
  value?: string | number | null
  defaultValue?: string | number
  onChange?: (e: SelectChangeEvent) => void
  disabled?: boolean
  required?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  children?: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

type Opt = { kind: 'option'; value: string; label: string; disabled: boolean; group?: string; index: number }
type Group = { kind: 'group'; label: string }
type Row = Opt | Group

type OptionProps = { value?: string | number | readonly string[]; children?: ReactNode; disabled?: boolean; label?: string }
type GroupProps = { label?: string; children?: ReactNode; disabled?: boolean }

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Läser <option>/<optgroup> (även i fragment och .map) till rader. */
function readRows(children: ReactNode): Row[] {
  const rows: Row[] = []
  let index = 0
  const walk = (nodes: ReactNode, group?: string, groupDisabled = false) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return
      const el = child as ReactElement<OptionProps & GroupProps>
      if (el.type === Fragment) return walk(el.props.children, group, groupDisabled)
      if (el.type === 'optgroup') {
        rows.push({ kind: 'group', label: el.props.label ?? '' })
        return walk(el.props.children, el.props.label ?? '', Boolean(el.props.disabled))
      }
      if (el.type === 'option') {
        const label = el.props.label ?? textOf(el.props.children)
        const value = el.props.value === undefined ? label : String(el.props.value)
        rows.push({ kind: 'option', value, label, disabled: groupDisabled || Boolean(el.props.disabled), group, index: index++ })
      }
    })
  }
  walk(children)
  return rows
}

const PHONE = '(max-width: 599px)'

function isPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches
}

function labelText(el: HTMLButtonElement | null, ariaLabel?: string, labelledBy?: string): string {
  if (ariaLabel) return ariaLabel
  if (!el) return ''
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim()
  }
  const label = el.labels?.[0]
  if (!label) return ''
  // Bara etikettens egen text, inte knappens värde om knappen ligger i etiketten.
  const copy = label.cloneNode(true) as HTMLElement
  copy.querySelectorAll('.b-select, .info-tooltip').forEach((n) => n.remove())
  return (copy.textContent ?? '').replace(/\s*\*\s*$/, '').trim()
}

export function Select({
  id,
  name,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
  style,
  title,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: SelectProps) {
  const base = useId()
  const listId = `${base}-list`
  const rows = readRows(children)
  const options = rows.filter((r): r is Opt => r.kind === 'option')
  const [inner, setInner] = useState(defaultValue === undefined ? undefined : String(defaultValue))
  const current = value !== undefined && value !== null ? String(value) : inner
  const selected = options.find((o) => o.value === current) ?? options[0]

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [phone, setPhone] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const [title_, setTitle] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const enabled = useCallback((i: number) => i >= 0 && i < options.length && !options[i].disabled, [options])

  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i
    return from
  }
  const first = () => step(-1, 1)
  const last = () => step(options.length, -1)

  const show = (at?: number) => {
    if (disabled || options.length === 0) return
    setPhone(isPhone())
    setTitle(labelText(trigger.current, ariaLabel, ariaLabelledBy))
    const sel = selected && enabled(selected.index) ? selected.index : first()
    setActive(at ?? sel)
    setOpen(true)
    // Safari fokuserar inte knappar vid klick: utan fokus når piltangenterna aldrig listan.
    if (document.activeElement !== trigger.current) trigger.current?.focus({ preventScroll: true })
  }

  const close = (focus = true) => {
    setOpen(false)
    setPlace(null)
    if (focus) trigger.current?.focus({ preventScroll: true })
  }

  const choose = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    close()
    if (o.value === current) return
    if (value === undefined) setInner(o.value)
    const target = { value: o.value, name }
    onChange?.({ target, currentTarget: target })
  }

  // Placering under/ovanför knappen, och ny placering när fönstret ändras.
  const position = useCallback(() => {
    const a = trigger.current
    const l = list.current
    if (!a || !l) return
    setPhone(isPhone())
    if (isPhone()) return setPlace(null)
    setPlace(placeList(a.getBoundingClientRect(), l.scrollHeight, window.innerWidth, window.innerHeight, l.offsetWidth))
  }, [])

  useLayoutEffect(() => {
    if (open) position()
  }, [open, position])

  // Stäng vid klick utanför, när sidan (eller en ruta runt knappen) rullar, och vid ändrad storlek: placera om.
  useEffect(() => {
    if (!open) return
    const down = (e: Event) => {
      const t = e.target as Node
      if (trigger.current?.contains(t) || layer.current?.contains(t)) return
      close(false)
    }
    const scroll = (e: Event) => {
      const t = e.target
      if (t instanceof Node && list.current?.contains(t)) return
      if (t === document || (t instanceof Node && trigger.current && t.contains(trigger.current))) close(false)
    }
    const resize = () => position()
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, position])

  // Raden man står på syns alltid (det valda när listan öppnas).
  useLayoutEffect(() => {
    if (!open || active < 0) return
    const l = list.current
    const row = l?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    if (!l || !row) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (top < l.scrollTop) l.scrollTop = top - 4
    else if (bottom > l.scrollTop + l.clientHeight) l.scrollTop = bottom - l.clientHeight + 4
  }, [open, active, place, phone])

  // Skriv början av ett alternativ för att hoppa dit.
  const typeahead = (key: string): number => {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > 700 ? key : t.text + key
    t.at = now
    const q = t.text.toLocaleLowerCase('sv')
    const same = q.split('').every((c) => c === q[0])
    const from = open ? active : (selected?.index ?? -1)
    const n = options.length
    for (let k = 1; k <= n; k++) {
      const i = (from + (same || q.length === 1 ? k : k - 1) + n) % n
      if (!enabled(i)) continue
      const text = options[i].label.toLocaleLowerCase('sv')
      if (text.startsWith(q) || (same && text.startsWith(q[0]))) return i
    }
    return -1
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const { key, altKey } = e
    const stop = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        stop()
        show()
      } else if (key === 'Home') {
        stop()
        show(first())
      } else if (key === 'End') {
        stop()
        show(last())
      } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !altKey && key !== ' ') {
        const i = typeahead(key)
        if (i >= 0) {
          stop()
          show(i)
        }
      }
      return
    }
    switch (key) {
      case 'ArrowDown':
        stop()
        return setActive((i) => step(i, 1))
      case 'ArrowUp':
        stop()
        if (altKey) return choose(active)
        return setActive((i) => step(i, -1))
      case 'Home':
        stop()
        return setActive(first())
      case 'End':
        stop()
        return setActive(last())
      case 'PageDown':
        stop()
        return setActive((i) => {
          let j = i
          for (let k = 0; k < 10; k++) j = step(j, 1)
          return j
        })
      case 'PageUp':
        stop()
        return setActive((i) => {
          let j = i
          for (let k = 0; k < 10; k++) j = step(j, -1)
          return j
        })
      case 'Enter':
        stop()
        return choose(active)
      case ' ':
        stop()
        // Mellanslag mitt i en sökning är en bokstav, annars ett val.
        if (Date.now() - typed.current.at < 700 && typed.current.text) {
          const i = typeahead(' ')
          if (i >= 0) setActive(i)
          return
        }
        return choose(active)
      case 'Escape':
        stop()
        // Stoppar även fönstrets lyssnare, så att en dialog runt omkring inte stängs.
        e.nativeEvent.stopImmediatePropagation()
        return close()
      case 'Tab':
        return close(false)
      default:
        if (key.length === 1 && !e.ctrlKey && !e.metaKey && !altKey) {
          const i = typeahead(key)
          if (i >= 0) {
            stop()
            setActive(i)
          }
        }
    }
  }

  const activeId = open && active >= 0 ? `${base}-opt-${active}` : undefined
  const style_: CSSProperties | undefined =
    place && !phone
      ? { top: place.top, bottom: place.bottom, left: place.left, minWidth: place.minWidth, maxHeight: place.maxHeight }
      : undefined

  const popup = open
    ? createPortal(
        <div
          ref={layer}
          className={`b-select-layer${phone ? ' is-sheet' : ''}`}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.preventDefault()}
        >
          {phone && <div className="b-select-scrim" aria-hidden="true" onClick={() => close()} />}
          <div
            className={`b-select-pop${phone ? ' b-select-sheet' : ''}${place?.above ? ' is-above' : ''}${place || phone ? ' is-placed' : ''}`}
            style={style_}
          >
            {phone && title_ && (
              <p className="b-select-title" aria-hidden="true">
                {title_}
              </p>
            )}
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-label={title_ || undefined}
              tabIndex={-1}
              className="b-select-list"
            >
              {rows.map((r, k) =>
                r.kind === 'group' ? (
                  <li key={`g${k}`} role="presentation" className="b-select-group">
                    {r.label}
                  </li>
                ) : (
                  <li
                    key={`o${r.index}`}
                    id={`${base}-opt-${r.index}`}
                    role="option"
                    data-index={r.index}
                    data-value={r.value}
                    aria-selected={r.value === selected?.value}
                    aria-disabled={r.disabled || undefined}
                    className={`b-select-option${r.index === active ? ' is-active' : ''}${r.group !== undefined ? ' in-group' : ''}`}
                    onPointerMove={() => !r.disabled && r.index !== active && setActive(r.index)}
                    onClick={() => choose(r.index)}
                  >
                    <span className="b-select-option-text">{r.label}</span>
                    {r.value === selected?.value && <Icon name="check" size={16} className="b-select-check" />}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={trigger}
        type="button"
        id={id}
        role="combobox"
        className={className ? `b-select ${className}` : 'b-select'}
        style={style}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        value={selected?.value ?? ''}
        data-value={selected?.value ?? ''}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          if (open && !layer.current?.contains(e.relatedTarget as Node | null)) close(false)
        }}
      >
        <span className="b-select-value">{selected?.label ?? ''}</span>
        <Icon name="chevron-down" size={16} className="b-select-chevron" />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={selected?.value ?? ''} />}
      {popup}
    </>
  )
}

/** Samma rullista i märkets fält (@booqy/brand Field): pillerform som Input. */
export function BrandSelect({ className, ...props }: SelectProps) {
  return <Select {...props} className={className ? `bq-select ${className}` : 'bq-select'} />
}
