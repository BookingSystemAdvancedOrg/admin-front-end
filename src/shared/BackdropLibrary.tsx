import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { isApiConfigured } from './api'
import {
  deleteBackdrop,
  getLibrary,
  loadLibrary,
  selectBackdrop,
  subscribeLibrary,
  uploadBackdrop,
  type BackdropItem,
  type UploadError,
} from './backdropStore'
import { BackdropPreview } from './BackdropPreview'
import { ErrorNote } from './ErrorNote'

const UPLOAD_ERRORS: Record<UploadError, string> = {
  'not-image': 'Det där är ingen bild. Välj en JPG-, PNG-, WebP- eller HEIC-bild.',
  unreadable: 'Bilden gick inte att läsa här. Prova en JPG eller PNG.',
  'too-large': 'Bilden är för stor, även förminskad. Prova en annan bild.',
  limit: 'Biblioteket är fullt. Ta bort en bild för att ladda upp en ny.',
  failed: 'Bilden kunde inte sparas. Försök igen.',
}

const at = (e: MouseEvent) => (e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined)
const when = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })

/** Användarens egna bilder: rutnät med uppladdning, val och förhandsvisning. */
export function BackdropLibrary() {
  const lib = useSyncExternalStore(subscribeLibrary, getLibrary, getLibrary)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirmFor, setConfirmFor] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!lib.loaded) void loadLibrary()
  }, [lib.loaded])
  useEffect(() => {
    if (!menuFor) return
    const close = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.('.bg-tile-menu')) setMenuFor(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuFor(null)
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [menuFor])

  async function onFile(f: File | undefined) {
    if (!f) return
    setError(null)
    const err = await uploadBackdrop(f, setProgress)
    setProgress(null)
    if (err) {
      setError(UPLOAD_ERRORS[err])
      file.current?.focus()
    }
    if (file.current) file.current.value = ''
  }

  async function remove(item: BackdropItem) {
    setConfirmFor(null)
    setMenuFor(null)
    if (!(await deleteBackdrop(item.id))) setError('Bilden kunde inte tas bort. Försök igen.')
  }

  const full = lib.items.length >= lib.max

  return (
    <div className="bg-library">
      <div className="bg-library-head">
        <span className="bg-library-count">
          {lib.items.length} av {lib.max} bilder
        </span>
        {!isApiConfigured() && <span className="bg-library-note">Lokalt: bilderna sparas inte</span>}
      </div>

      {lib.loaded && lib.items.length === 0 && (
        <p className="bg-library-empty">Inga egna bilder än.</p>
      )}

      <ul className="bg-grid" aria-label="Dina bilder">
        <li className="bg-cell">
          <label className={`bg-tile bg-tile--upload${full ? ' is-disabled' : ''}`} aria-disabled={full || undefined}>
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="bg-upload-input"
              disabled={full || progress !== null}
              aria-label="Ladda upp ny bild"
              aria-describedby={error ? 'bg-library-error' : undefined}
              onChange={(e) => void onFile(e.currentTarget.files?.[0])}
            />
            {progress === null ? (
              <span className="bg-upload-label">
                <span aria-hidden="true" className="bg-upload-plus">+</span>
                {full ? 'Biblioteket är fullt' : 'Ladda upp ny'}
              </span>
            ) : (
              <span className="bg-upload-progress" role="progressbar" aria-label="Laddar upp" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span className="bg-upload-bar" style={{ inlineSize: `${Math.round(progress * 100)}%` }} />
                <span className="bg-upload-pct">{Math.round(progress * 100)} %</span>
              </span>
            )}
          </label>
        </li>
        {lib.items.map((item, index) => {
          const selected = item.id === lib.selectedId
          return (
            <li key={item.id} className="bg-cell">
              <div className={`bg-tile${selected ? ' is-selected' : ''}`}>
                <button type="button" className="bg-thumb" aria-label={`Visa bild från ${when(item.uploadedAt)}${selected ? ', vald som bakgrund' : ''}`} onClick={() => setPreview(index)}>
                  <img src={item.thumbUrl} alt={`Egen bakgrund från ${when(item.uploadedAt)}`} loading="lazy" decoding="async" />
                </button>
                {selected && (
                  <span className="bg-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </span>
                )}
                <div className="bg-tile-menu">
                  <button
                    type="button"
                    className="bg-tile-more"
                    aria-label={`Fler val för bilden från ${when(item.uploadedAt)}`}
                    aria-expanded={menuFor === item.id}
                    onClick={() => {
                      setConfirmFor(null)
                      setMenuFor(menuFor === item.id ? null : item.id)
                    }}
                  >
                    <span aria-hidden="true">…</span>
                  </button>
                  {menuFor === item.id && (
                    <div className="bg-menu" role="menu">
                      {!selected && (
                        <button type="button" role="menuitem" className="row-action" onClick={(e) => { setMenuFor(null); void selectBackdrop(item.id, at(e)) }}>
                          Använd som bakgrund
                        </button>
                      )}
                      <button type="button" role="menuitem" className="row-action" onClick={() => { setMenuFor(null); setPreview(index) }}>
                        Visa
                      </button>
                      {confirmFor === item.id ? (
                        <button type="button" role="menuitem" className="row-action danger" onClick={() => void remove(item)}>
                          Ja, ta bort
                        </button>
                      ) : (
                        <button type="button" role="menuitem" className="row-action danger" onClick={() => setConfirmFor(item.id)}>
                          Ta bort
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {error && (
        <ErrorNote id="bg-library-error" className="bg-library-error" text={error} />
      )}

      {preview !== null && lib.items[preview] && (
        <BackdropPreview
          items={lib.items}
          index={preview}
          selectedId={lib.selectedId}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
          onUse={(id, origin) => void selectBackdrop(id, origin)}
          onDelete={async (id) => {
            const next = lib.items.length - 1
            if (await deleteBackdrop(id)) setPreview(next > 0 ? Math.min(preview, next - 1) : null)
          }}
        />
      )}
    </div>
  )
}
