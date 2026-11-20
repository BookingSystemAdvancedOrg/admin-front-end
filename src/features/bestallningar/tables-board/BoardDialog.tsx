import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import ModalOverlay from '../../../shared/ModalOverlay'
import { Icon } from '../../../shared/Icon'

/**
 * The Bord view's dialogs (Stäng, Flytta, Makulera): a Booqy modal that
 * becomes a bottom sheet on phones, closes on Escape or a press outside
 * and keeps its action buttons pinned at the bottom (56 px on touch).
 */
export function BoardDialog({
  title,
  onClose,
  children,
  actions,
  className = '',
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  actions: ReactNode
  className?: string
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus()
    }
  }, [])
  return (
    <ModalOverlay className="board-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`modal board-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="board-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn outline square board-dialog-x" aria-label="Stäng rutan" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="board-dialog-body">{children}</div>
        <div className="modal-actions board-dialog-actions">{actions}</div>
      </div>
    </ModalOverlay>
  )
}
