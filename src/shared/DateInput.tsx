import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import './dateInput.css'

/**
 * Datum och tid i svenskt format oavsett webbläsarens språk: DD/MM/ÅÅÅÅ och
 * 24-timmarsklocka (TT:MM). Ett vanligt <input type="date"> visar det format
 * webbläsaren är inställd på (t.ex. MM/DD/YYYY och PM i en engelsk Chrome).
 *
 * Värdena in och ut är desamma som de inbyggda fälten: "YYYY-MM-DD",
 * "HH:MM" och "YYYY-MM-DDTHH:MM", och "" när fältet är tomt eller ofullständigt.
 * onChange får { target: { value } } så att anropen ser ut som förut.
 */

type Change = (e: { target: { value: string } }) => void

type Common = {
  id?: string
  value: string
  onChange: Change
  disabled?: boolean
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december']
const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön']

const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function validIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d > days ? null : isoOf(y, m, d)
}

/** "2026-10-22" -> "22/10/2026". */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** "22/10/2026" (även 22.10.2026, 2/3/2026 och ISO) -> "2026-10-22", annars null. */
export function parseDate(text: string): string | null {
  const t = text.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return validIso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
  if (m) return validIso(+m[3], +m[2], +m[1])
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(t)
  return m ? validIso(+m[3], +m[2], +m[1]) : null
}

/** "1430", "14.30", "9:05" -> "14:30" / "09:05", annars null. */
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim())
  if (!m || +m[1] > 23 || +m[2] > 59) return null
  return `${pad(+m[1])}:${pad(+m[2])}`
}

/** Skrivhjälp: snedstreck efter dag och månad, aldrig dubbla avgränsare. */
function maskDate(raw: string, prev: string): string {
  if (/^\d{4}-/.test(raw)) return raw.slice(0, 16)
  let t = raw.replace(/[.\-\s]/g, '/').replace(/[^\d/]/g, '').replace(/\/{2,}/g, '/')
  if (raw.length > prev.length && (/^\d{2}$/.test(t) || /^\d{1,2}\/\d{2}$/.test(t))) t += '/'
  return t.slice(0, 10)
}

function maskTime(raw: string, prev: string): string {
  let t = raw.replace('.', ':').replace(/[^\d:]/g, '').replace(/:{2,}/g, ':')
  if (raw.length > prev.length && /^\d{2}$/.test(t)) t += ':'
  return t.slice(0, 5)
}

function inRange(iso: string, min?: string, max?: string) {
  return (!min || iso >= min.slice(0, 10)) && (!max || iso <= max.slice(0, 10))
}

// Bara en kalender i taget: en ny stänger den som redan är öppen.
let closeOpenCalendar: (() => void) | null = null

function todayIso() {
  const d = new Date()
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** Datum som DD/MM/ÅÅÅÅ, med en kalender (veckan börjar på måndag). */
export function DateInput({ value, onChange, min, max, ...rest }: Common & { min?: string; max?: string }) {
  const [text, setText] = useState(() => formatDate(value))
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const close = useRef(() => setOpen(false)).current

  // Följ värdet utifrån (t.ex. "Rensa schema") men skriv inte över det som håller på att skrivas.
  useEffect(() => {
    const current = parseDate(text)
    if ((current && inRange(current, min, max) ? current : '') !== value) setText(formatDate(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function update(next: string) {
    const iso = parseDate(next)
    const ok = iso && inRange(iso, min, max) ? iso : ''
    setText(iso && /^\d{4}-/.test(next) ? formatDate(iso) : next)
    onChange({ target: { value: ok } })
  }

  const parsed = parseDate(text)
  const invalid = text !== '' && !(parsed && inRange(parsed, min, max))

  return (
    <span className={`date-input ${rest.className ?? ''}`} ref={wrap}>
      <input
        ref={input}
        id={rest.id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/ÅÅÅÅ"
        data-min={min}
        data-max={max}
        value={text}
        disabled={rest.disabled}
        aria-label={rest['aria-label']}
        aria-invalid={rest['aria-invalid'] || invalid || undefined}
        aria-describedby={rest['aria-describedby']}
        onChange={(e) => {
          const t = e.target.value
          // Ett helt datum med tid (t.ex. inklistrat) hanteras av DateTimeInput.
          if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return update(t.slice(0, 10))
          update(maskDate(t, text))
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && e.altKey) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      />
      <button
        type="button"
        className="date-input-btn"
        aria-label="Öppna kalender"
        aria-expanded={open}
        disabled={rest.disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && (
        <Calendar
          anchor={wrap}
          selected={parsed && inRange(parsed, min, max) ? parsed : value || ''}
          min={min?.slice(0, 10)}
          max={max?.slice(0, 10)}
          onPick={(iso) => {
            update(formatDate(iso))
            setOpen(false)
            input.current?.focus()
          }}
          onClose={close}
        />
      )}
    </span>
  )
}

/** Tid som TT:MM, 24-timmarsklocka. */
export function TimeInput({ value, onChange, ...rest }: Common & { step?: number }) {
  const [text, setText] = useState(value)

  useEffect(() => {
    if ((parseTime(text) ?? '') !== value) setText(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const invalid = text !== '' && !parseTime(text)
  return (
    <input
      id={rest.id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="TT:MM"
      className={`time-input ${rest.className ?? ''}`}
      value={text}
      disabled={rest.disabled}
      aria-label={rest['aria-label']}
      aria-invalid={rest['aria-invalid'] || invalid || undefined}
      aria-describedby={rest['aria-describedby']}
      onChange={(e) => {
        const next = maskTime(e.target.value, text)
        setText(next)
        onChange({ target: { value: parseTime(next) ?? '' } })
      }}
      onBlur={() => {
        const t = parseTime(text)
        if (t && t !== text) setText(t)
      }}
    />
  )
}

/** Datum och tid ("YYYY-MM-DDTHH:MM"), som <input type="datetime-local">. */
export function DateTimeInput({
  value,
  onChange,
  min,
  timeLabel,
  ...rest
}: Common & { min?: string; timeLabel: string }) {
  const [date, setDate] = useState(value.slice(0, 10))
  const [time, setTime] = useState(value.slice(11, 16))

  useEffect(() => {
    const current = date && time ? `${date}T${time}` : ''
    if (current !== value) {
      setDate(value.slice(0, 10))
      setTime(value.slice(11, 16))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(d: string, t: string) {
    onChange({ target: { value: d && t ? `${d}T${t}` : '' } })
  }

  return (
    <span className="datetime-input">
      <DateInput
        {...rest}
        value={date}
        min={min}
        onChange={(e) => {
          setDate(e.target.value)
          emit(e.target.value, time)
        }}
      />
      <TimeInput
        value={time}
        disabled={rest.disabled}
        aria-label={timeLabel}
        aria-invalid={rest['aria-invalid']}
        onChange={(e) => {
          setTime(e.target.value)
          emit(date, e.target.value)
        }}
      />
    </span>
  )
}

function Calendar({
  anchor,
  selected,
  min,
  max,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLSpanElement | null>
  selected: string
  min?: string
  max?: string
  onPick: (iso: string) => void
  onClose: () => void
}) {
  const today = todayIso()
  const start = selected || (min && min > today ? min : today)
  const [view, setView] = useState({ y: +start.slice(0, 4), m: +start.slice(5, 7) })
  const [focus, setFocus] = useState(start)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const panel = useRef<HTMLDivElement>(null)

  // Fast position under fältet (eller ovanför om det inte får plats), så att modaler inte klipper kalendern.
  useLayoutEffect(() => {
    function place() {
      const a = anchor.current?.getBoundingClientRect()
      const h = panel.current?.offsetHeight ?? 320
      const w = panel.current?.offsetWidth ?? 280
      if (!a) return
      const below = a.bottom + 6 + h <= window.innerHeight
      setPos({
        top: below ? a.bottom + 6 : Math.max(8, a.top - 6 - h),
        left: Math.max(8, Math.min(a.left, window.innerWidth - w - 8)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    closeOpenCalendar?.()
    closeOpenCalendar = onClose
    return () => {
      if (closeOpenCalendar === onClose) closeOpenCalendar = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (!anchor.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [anchor, onClose])

  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus()
  }, [focus, view])

  const first = new Date(Date.UTC(view.y, view.m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const daysIn = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => isoOf(view.y, view.m, i + 1))]
  const allowed = (iso: string) => inRange(iso, min, max)

  function shift(months: number) {
    const d = new Date(Date.UTC(view.y, view.m - 1 + months, 1))
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (!step) return
    e.preventDefault()
    const d = new Date(`${focus}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + step)
    const next = d.toISOString().slice(0, 10)
    setFocus(next)
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 })
  }

  return (
    <div
      ref={panel}
      className="date-cal"
      role="dialog"
      aria-label="Välj datum"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      onKeyDown={onKey}
    >
      <div className="date-cal-head">
        <button type="button" className="date-cal-nav" aria-label="Föregående månad" onClick={() => shift(-1)}>
          ‹
        </button>
        <span className="date-cal-title">
          {MONTHS[view.m - 1]} {view.y}
        </span>
        <button type="button" className="date-cal-nav" aria-label="Nästa månad" onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="date-cal-grid" role="grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="date-cal-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              data-iso={iso}
              tabIndex={iso === focus ? 0 : -1}
              className={`date-cal-day${iso === selected ? ' is-selected' : ''}${iso === today ? ' is-today' : ''}`}
              aria-label={`${+iso.slice(8)} ${MONTHS[view.m - 1]} ${view.y}`}
              aria-pressed={iso === selected}
              disabled={!allowed(iso)}
              onClick={() => onPick(iso)}
            >
              {+iso.slice(8)}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <button
        type="button"
        className="date-cal-today"
        disabled={!allowed(today)}
        onClick={() => onPick(today)}
      >
        Idag
      </button>
    </div>
  )
}
