import { useEffect, useRef, useState } from 'react'
import ModalOverlay from './ModalOverlay'
import type { BackdropItem } from './backdropStore'

/**
 * Förhandsvisning av en egen bild: glasdialog i mitten med hela bilden.
 * Pilar och svep byter bild, Esc och klick utanför stänger. Den förminskade
 * bilden visas suddig tills hela bilden har laddats.
 */
export function BackdropPreview({
  items,
  index,
  selectedId,
  onIndex,
  onClose,
  onUse,
  onDelete,
}: {
  items: BackdropItem[]
  index: number
  selectedId: string | null
  onIndex: (i: number) => void
  onClose: () => void
  onUse: (id: string, origin?: { x: number; y: number }) => void
  onDelete: (id: string) => void
}) {
  const item = items[index]
  const [loaded, setLoaded] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const start = useRef<number | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const go = (d: number) => onIndex((index + d + items.length) % items.length)

  useEffect(() => {
    setLoaded(false)
    setConfirm(false)
  }, [item.id])
  useEffect(() => {
    closeBtn.current?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && items.length > 1) go(1)
      else if (e.key === 'ArrowLeft' && items.length > 1) go(-1)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  const selected = item.id === selectedId
  const date = new Date(item.uploadedAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal bg-preview" role="dialog" aria-modal="true" aria-label={`Bild från ${date}`}>
        <div className="bg-preview-head">
          <h2>{selected ? 'Din bakgrund' : 'Egen bild'}</h2>
          <button ref={closeBtn} type="button" className="row-action bg-preview-close" aria-label="Stäng" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          className="bg-preview-stage"
          onPointerDown={(e) => (start.current = e.clientX)}
          onPointerUp={(e) => {
            if (start.current === null || items.length < 2) return
            const dx = e.clientX - start.current
            start.current = null
            if (Math.abs(dx) > 48) go(dx < 0 ? 1 : -1)
          }}
          style={{ aspectRatio: `${item.width} / ${item.height}` }}
        >
          <img className="bg-preview-thumb" src={item.thumbUrl} alt="" aria-hidden="true" />
          <img
            key={item.id}
            className={`bg-preview-full${loaded ? ' is-loaded' : ''}`}
            src={item.url}
            alt={`Egen bakgrund från ${date}`}
            decoding="async"
            onLoad={() => setLoaded(true)}
          />
          {items.length > 1 && (
            <>
              <button type="button" className="bg-preview-nav bg-preview-nav--prev" aria-label="Föregående bild" onClick={() => go(-1)}>
                <span aria-hidden="true">‹</span>
              </button>
              <button type="button" className="bg-preview-nav bg-preview-nav--next" aria-label="Nästa bild" onClick={() => go(1)}>
                <span aria-hidden="true">›</span>
              </button>
            </>
          )}
        </div>
        <p className="bg-preview-meta">
          {date} · {item.width} × {item.height} px{items.length > 1 ? ` · ${index + 1} av ${items.length}` : ''}
        </p>
        <div className="modal-actions bg-preview-actions">
          {confirm ? (
            <button type="button" className="row-action danger" onClick={() => onDelete(item.id)}>
              Ja, ta bort bilden
            </button>
          ) : (
            <button type="button" className="row-action danger" onClick={() => setConfirm(true)}>
              Ta bort
            </button>
          )}
          <button
            type="button"
            className="btn primary square"
            disabled={selected}
            onClick={(e) => onUse(item.id, e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined)}
          >
            {selected ? 'Används som bakgrund' : 'Använd som bakgrund'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
