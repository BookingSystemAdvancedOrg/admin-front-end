import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { coverCrop, cropSquare, getMyAvatar, loadMyAvatar, removeMyAvatar, saveMyAvatar, subscribeMyAvatar } from './avatarStore'
import { Avatar } from './Avatar'
import ModalOverlay from './ModalOverlay'
import { ErrorNote } from './ErrorNote'

const VIEW = 240

/** Den inloggades profilbild i sidomenyn: en knapp som öppnar en liten dialog. */
export function MyAvatarButton({ name, email }: { name?: string | null; email?: string | null }) {
  const mine = useSyncExternalStore(subscribeMyAvatar, getMyAvatar, getMyAvatar)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!mine.loaded) void loadMyAvatar()
  }, [mine.loaded])
  return (
    <>
      <button type="button" className="admin-avatar-btn" aria-label="Profilbild" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Avatar url={mine.url} name={name} email={email} size="sm" />
      </button>
      {open && <ProfilePictureDialog name={name} email={email} onClose={() => setOpen(false)} />}
    </>
  )
}

function ProfilePictureDialog({ name, email, onClose }: { name?: string | null; email?: string | null; onClose: () => void }) {
  const mine = useSyncExternalStore(subscribeMyAvatar, getMyAvatar, getMyAvatar)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src])

  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal profile-picture" role="dialog" aria-modal="true" aria-label="Profilbild">
        <h2>Profilbild</h2>
        {src ? (
          <CropStep
            src={src}
            onCancel={() => setSrc(null)}
            onSaved={(ok) => {
              setSrc(null)
              if (!ok) setError('Bilden kunde inte sparas. Försök igen, eller prova en JPG eller PNG.')
            }}
          />
        ) : (
          <>
            <div className="profile-picture-now">
              <Avatar url={mine.url} name={name} email={email} size="lg" />
              <p className="modal-text">Frivilligt. Bilden visas bredvid ditt namn i Personal. Utan bild visas dina initialer.</p>
            </div>
            <ErrorNote text={error} />
            <div className="modal-actions">
              {mine.url && (
                <button type="button" className="row-action danger" onClick={() => void removeMyAvatar().then((ok) => !ok && setError('Bilden kunde inte tas bort. Försök igen.'))}>
                  Ta bort bild
                </button>
              )}
              <button type="button" className="btn outline square" onClick={onClose}>
                Stäng
              </button>
              <label className="btn primary square profile-picture-choose">
                <input
                  ref={input}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="profile-picture-input"
                  onChange={(e) => {
                    const f = e.currentTarget.files?.[0]
                    setError(null)
                    if (f) setSrc(URL.createObjectURL(f))
                    e.currentTarget.value = ''
                  }}
                />
                {mine.url ? 'Byt bild' : 'Välj bild'}
              </label>
            </div>
          </>
        )}
      </div>
    </ModalOverlay>
  )
}

function CropStep({ src, onCancel, onSaved }: { src: string; onCancel: () => void; onSaved: (ok: boolean) => void }) {
  const img = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const crop = size ? coverCrop(size.w, size.h, VIEW, zoom, offset.x, offset.y) : null
  const nudge = (dx: number, dy: number) => setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))

  async function save() {
    if (!img.current || !crop) return
    setBusy(true)
    let ok = false
    try {
      ok = await saveMyAvatar(await cropSquare(img.current, crop, VIEW))
    } catch {
      ok = false
    }
    setBusy(false)
    onSaved(ok)
  }

  return (
    <div className="avatar-crop">
      <div
        className="avatar-crop-view"
        style={{ inlineSize: VIEW, blockSize: VIEW }}
        tabIndex={0}
        role="application"
        aria-label="Dra, eller använd piltangenterna, för att flytta bilden"
        onKeyDown={(e) => {
          const step = e.shiftKey ? 24 : 8
          if (e.key === 'ArrowLeft') nudge(-step, 0)
          else if (e.key === 'ArrowRight') nudge(step, 0)
          else if (e.key === 'ArrowUp') nudge(0, -step)
          else if (e.key === 'ArrowDown') nudge(0, step)
          else return
          e.preventDefault()
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          ref={img}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => onSaved(false)}
          style={crop ? { transform: `translate(${crop.x}px, ${crop.y}px) scale(${crop.scale})` } : { opacity: 0 }}
        />
      </div>
      <label className="avatar-crop-zoom">
        <span className="cell-muted">Zooma</span>
        <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.currentTarget.value))} />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn outline square" onClick={onCancel} disabled={busy}>
          Avbryt
        </button>
        <button type="button" className="btn primary square" onClick={() => void save()} disabled={!crop || busy}>
          {busy ? 'Sparar…' : 'Spara bild'}
        </button>
      </div>
    </div>
  )
}
