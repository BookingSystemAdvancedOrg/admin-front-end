import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * "Vill du logga ut?" - frågas innan utloggning från sidomenyn, så att ingen
 * loggas ut av ett felklick mitt i ett pass.
 *
 * Fokus hamnar på "Nej" (det säkra valet). Escape eller klick utanför rutan
 * = nej. Tab stannar i rutan, och fokus går tillbaka till knappen som
 * öppnade den när den stängs.
 */
export function LogoutConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [onCancel])

  // Håll Tab inom de två knapparna.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return
    const first = cancelRef.current
    const last = confirmRef.current
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal modal--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="logout-confirm-title"
        aria-describedby="logout-confirm-text"
        onKeyDown={trapTab}
      >
        <h2 id="logout-confirm-title">Vill du logga ut?</h2>
        <p id="logout-confirm-text" className="modal-text">
          Du behöver logga in igen för att fortsätta arbeta i Booqy Admin.
        </p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn outline square" onClick={onCancel}>
            Nej, stanna kvar
          </button>
          <button ref={confirmRef} type="button" className="btn primary square" onClick={onConfirm}>
            Ja, logga ut
          </button>
        </div>
      </div>
    </div>
  )
}
