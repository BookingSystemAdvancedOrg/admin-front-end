import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import type { IconName } from './Icon'

/**
 * Kommandopaletten (⌘K, Ctrl+K på Windows och Linux, eller sökrutan i
 * sidhuvudet). En centrerad glasruta över en nedtonad sida: ett sökfält med
 * fokus, träffar i grupper (Åtgärder, Gå till, Senaste), pilarna flyttar,
 * Enter kör och Esc stänger. Fokus går tillbaka dit det var.
 */

export type PaletteItem = {
  id: string
  group: 'Åtgärder' | 'Gå till' | 'Senaste'
  label: string
  hint?: string
  icon: IconName
  /** Fler ord som ska ge träff (t.ex. "tema" för Utseende). */
  keywords?: string
  run: () => void
}

const OPEN_EVENT = 'booqy:palette'
const GROUP_ORDER: PaletteItem['group'][] = ['Åtgärder', 'Gå till', 'Senaste']

/** Öppnar paletten (sökrutan i sidhuvudet). */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** "⌘K" på Mac och iPad, annars "Ctrl K". */
export function paletteShortcut(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return /Mac|iPhone|iPad/.test(ua) ? '⌘K' : 'Ctrl K'
}

/** Gemener utan accenter, så att "oversikt" hittar "Översikt". */
function fold(text: string): string {
  return text.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function CommandPalette({ items }: { items: () => PaletteItem[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const baseId = useId()

  const show = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setQuery('')
    setActive(0)
    setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
    // Tillbaka till knappen eller fältet man stod på.
    requestAnimationFrame(() => returnTo.current?.focus?.())
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (open) close()
        else show()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, show)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, show)
    }
  }, [open, show, close])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prev
    }
  }, [open])

  // Listan räknas när paletten öppnas (rätt sidor och senaste för stunden).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => (open ? items() : []), [open])
  const results = useMemo(() => {
    const q = fold(query.trim())
    const hit = q ? all.filter((i) => fold(`${i.label} ${i.hint ?? ''} ${i.keywords ?? ''}`).includes(q)) : all
    return GROUP_ORDER.flatMap((g) => hit.filter((i) => i.group === g))
  }, [all, query])
  const current = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current, results])

  if (!open) return null

  const optionId = (i: number) => `${baseId}-opt-${i}`
  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    setOpen(false)
    returnTo.current = null
    item.run()
  }
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(results.length ? (current + 1) % results.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(results.length ? (current - 1 + results.length) % results.length : 0)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(results.length - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[current])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      // Fokus stannar i fältet; pilarna väljer.
      e.preventDefault()
    }
  }

  let index = -1
  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Sök och kommandon" onKeyDown={onKeyDown}>
        <div className="palette-search">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${baseId}-list`}
            aria-activedescendant={results.length ? optionId(current) : undefined}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Sök sidor och åtgärder"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
          />
          <kbd className="palette-kbd">Esc</kbd>
        </div>
        <div className="palette-list" id={`${baseId}-list`} role="listbox" aria-label="Träffar" ref={listRef}>
          {results.length === 0 && <p className="palette-empty">Inga träffar för ”{query.trim()}”.</p>}
          {GROUP_ORDER.map((group) => {
            const inGroup = results.filter((r) => r.group === group)
            if (inGroup.length === 0) return null
            const headId = `${baseId}-g${GROUP_ORDER.indexOf(group)}`
            return (
              <div key={group} role="group" aria-labelledby={headId} className="palette-group">
                <p className="palette-group-label" id={headId}>
                  {group}
                </p>
                {inGroup.map((item) => {
                  index += 1
                  const i = index
                  return (
                    <div
                      key={item.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === current}
                      className="palette-option"
                      onMouseMove={() => i !== current && setActive(i)}
                      onClick={() => run(item)}
                    >
                      <span className="palette-option-icon" aria-hidden="true">
                        <Icon name={item.icon} size={18} />
                      </span>
                      <span className="palette-option-label">{item.label}</span>
                      {item.hint && <span className="palette-option-hint">{item.hint}</span>}
                      <Icon name="arrow-right" size={16} className="palette-option-go" />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        <p className="palette-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> välj</span>
          <span><kbd>Enter</kbd> öppna</span>
          <span><kbd>Esc</kbd> stäng</span>
        </p>
      </div>
    </div>,
    document.body,
  )
}

/** Den lilla sökrutan i sidhuvudet: öppnar paletten. */
export function PaletteTrigger() {
  return (
    <button type="button" className="palette-trigger" onClick={openPalette} aria-label={`Sök (${paletteShortcut()})`}>
      <Icon name="search" size={16} />
      <span className="palette-trigger-text">Sök</span>
      <kbd className="palette-trigger-kbd">{paletteShortcut()}</kbd>
    </button>
  )
}
