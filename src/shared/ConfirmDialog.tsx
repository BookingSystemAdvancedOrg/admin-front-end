import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import ModalOverlay from './ModalOverlay'

export type ConfirmOptions = {
  title: string
  text?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Röd knapp för det som inte går att ångra (ta bort, återbetala). */
  danger?: boolean
}

/**
 * Booqys bekräftelseruta (modal--confirm), i stället för webbläsarens
 * window.confirm som har operativsystemets utseende. Fokus på det säkra
 * valet; Escape eller klick utanför = avbryt; Tab stannar i rutan.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  cancelLabel = 'Avbryt',
  danger,
  onConfirm,
  onCancel,
}: ConfirmOptions & { onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus()
    }
  }, [onCancel])

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
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal modal--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={text ? 'confirm-dialog-text' : undefined}
        onKeyDown={trapTab}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        {text && (
          <p id="confirm-dialog-text" className="modal-text">
            {text}
          </p>
        )}
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="btn outline square" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn primary square"
            data-danger={danger ? 'true' : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

/**
 * Ersätter window.confirm: `const [confirmEl, ask] = useConfirm()`, rendera
 * `{confirmEl}` och skriv `if (!(await ask({...}))) return`.
 */
export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const ask = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  )
  const close = useCallback(
    (ok: boolean) => {
      setPending((p) => {
        p?.resolve(ok)
        return null
      })
    },
    [],
  )
  const onCancel = useCallback(() => close(false), [close])
  const onConfirm = useCallback(() => close(true), [close])
  const el = pending ? (
    <ConfirmDialog
      title={pending.title}
      text={pending.text}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  ) : null
  return [el, ask]
}
