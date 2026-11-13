import { useEffect, useRef } from 'react'
import ModalOverlay from './ModalOverlay'
import './lightbox.css'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Bilden i stort, ensam i en centrerad glasruta. Stängs med Esc, ett klick
 * utanför bilden eller stängknappen. Fokus stannar i rutan (Tab går runt)
 * och går tillbaka dit det var när rutan stängs.
 *
 * Esc fångas i fönstrets capture-fas och stoppas där, så en dialog under
 * (redigera rätt) inte stängs av samma tangenttryck. Rutan ligger i en
 * portal; React-händelser bubblar ändå upp i komponentträdet, så den ska
 * ritas utanför klickbara rader (se MenyPage).
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panel.current.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (before?.isConnected) before.focus()
    }
  }, [])

  return (
    <ModalOverlay
      className="lightbox-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeRef.current()
      }}
    >
      <div ref={panel} className="lightbox" role="dialog" aria-modal="true" aria-label={alt}>
        <img className="lightbox-img" src={src} alt={alt} />
        <button
          ref={closeBtn}
          type="button"
          className="lightbox-close"
          aria-label="Stäng bilden"
          data-help="meny:stang-bild"
          onClick={() => closeRef.current()}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </ModalOverlay>
  )
}
