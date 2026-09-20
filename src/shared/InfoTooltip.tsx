import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Litet infoikon-uppslag: klick öppnar en förklarande bubbla, stängs via X,
 * Escape, eller klick utanför. Tänkt att stå bredvid en <label> — placera den
 * som syskon, aldrig inuti <label>, annars triggar klicket både knappen och
 * labelns "fokusera fältet"-beteende.
 */
export function InfoTooltip({
  label,
  children,
}: {
  /** Fältets namn, används som bubblans aria-label. */
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <span className="info-tooltip" ref={rootRef}>
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={`Förklaring: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      {open && (
        <div className="info-tooltip-panel" role="dialog" aria-label={label}>
          <button
            type="button"
            className="info-tooltip-close"
            aria-label="Stäng"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
          <p>{children}</p>
        </div>
      )}
    </span>
  )
}
