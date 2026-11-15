import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Åtgärder på en rad i en tabell eller lista: lugna knappar utan kant
 * (className "row-action", "row-action danger" för det som tar bort). På
 * telefonen viks de ihop till en "…"-meny. Menyn ritar knapparna bara när
 * den är öppen, så de finns aldrig två gånger i sidan.
 */
export function RowActions({ label, children, tour }: { label: string; children: ReactNode; tour?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <span className="row-actions-box" ref={box} data-tour={tour}>
      <span className="row-actions row-actions--inline">{children}</span>
      <span className="row-menu">
        <button
          type="button"
          className="row-action row-menu-toggle"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">…</span>
        </button>
        {open && (
          <span className="row-menu-list" onClick={() => setOpen(false)}>
            {children}
          </span>
        )}
      </span>
    </span>
  )
}
