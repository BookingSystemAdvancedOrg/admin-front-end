import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { isApiConfigured } from './api'
import { removeBackdropImage, uploadBackdropImage, type UploadError } from './backdropImage'
import { isDesktopShell } from './desktopDownloads'
import {
  hasBackdropImage,
  readGlassBackdrop,
  refreshBackdropImage,
  setGlassBackdrop,
  subscribeGlassBackdrop,
  SWATCHES,
  type GlassBackdrop,
} from './glassBackdrop'

const at = (e: MouseEvent) => (e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined)

const UPLOAD_ERRORS: Record<UploadError, string> = {
  'not-image': 'Det där är ingen bild. Välj en JPG-, PNG-, WebP- eller HEIC-bild.',
  unreadable: 'Bilden gick inte att läsa här. Prova en JPG eller PNG.',
  'too-large': 'Bilden är för stor, även förminskad. Prova en annan bild.',
  failed: 'Bilden kunde inte sparas. Försök igen.',
  offline: 'Egen bild sparas på servern och fungerar när appen är kopplad till den.',
}

type Tab = 'clear' | 'colour' | 'image'

/**
 * Bakgrund bakom glaset. Skrivbordsappen: Genomskinligt (standard), Färg eller
 * Egen bild. Webbläsaren: Färg (med Booqys bakgrund som standard) eller Egen
 * bild; genomskinligt går bara i appen.
 */
export function BackdropSetting() {
  const shell = isDesktopShell()
  const [value, setValue] = useState<GlassBackdrop>(readGlassBackdrop)
  const [hasImage, setHasImage] = useState(hasBackdropImage)
  const [lastColour, setLastColour] = useState(value.mode === 'colour' ? value.colour : SWATCHES[0].colour)
  const [tab, setTab] = useState<Tab>(value.mode === 'clear' ? (shell ? 'clear' : 'colour') : value.mode)
  const [error, setError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      subscribeGlassBackdrop(() => {
        setValue(readGlassBackdrop())
        setHasImage(hasBackdropImage())
      }),
    [],
  )
  useEffect(() => {
    if (tab === 'image' && !hasBackdropImage() && isApiConfigured()) void refreshBackdropImage().then(setHasImage)
  }, [tab])

  const colour = value.mode === 'colour' ? value.colour : null
  const pick = (c: string, e?: MouseEvent) => {
    setLastColour(c)
    setGlassBackdrop({ mode: 'colour', colour: c }, e ? at(e) : undefined)
  }
  const clear = (e: MouseEvent) => setGlassBackdrop({ mode: 'clear' }, at(e))

  const choose = (next: Tab, e: MouseEvent) => {
    setError(null)
    setTab(next)
    if (next === 'clear') clear(e)
    else if (next === 'colour' && shell && colour === null) pick(lastColour, e)
    else if (next === 'image' && hasBackdropImage()) setGlassBackdrop({ mode: 'image' }, at(e))
  }

  async function onFile(f: File | undefined) {
    if (!f) return
    setError(null)
    const err = await uploadBackdropImage(f)
    if (err) {
      setError(UPLOAD_ERRORS[err])
      file.current?.focus()
    }
    if (file.current) file.current.value = ''
  }

  async function onRemove(e: MouseEvent) {
    setError(null)
    if (!(await removeBackdropImage(at(e)))) setError('Bilden kunde inte tas bort. Försök igen.')
    else setTab(shell ? 'clear' : 'colour')
  }

  const tabs: { id: Tab; label: string }[] = [
    ...(shell ? [{ id: 'clear' as const, label: 'Genomskinligt' }] : []),
    { id: 'colour', label: 'Färg' },
    { id: 'image', label: 'Egen bild' },
  ]

  return (
    <div className="backdrop-setting">
      <div className="backdrop-segment" role="group" aria-label="Bakgrund">
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={(e) => choose(t.id, e)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'colour' && (
        <div className="backdrop-swatches" role="group" aria-label="Färg bakom glaset">
          {!shell && (
            <button
              type="button"
              className="backdrop-swatch backdrop-swatch--brand"
              aria-pressed={value.mode === 'clear'}
              aria-label="Booqys bakgrund"
              title="Booqys bakgrund"
              onClick={clear}
            />
          )}
          {SWATCHES.map((s) => (
            <button
              key={s.colour}
              type="button"
              className="backdrop-swatch"
              style={{ background: s.colour }}
              aria-pressed={colour === s.colour}
              aria-label={s.name}
              title={s.name}
              onClick={(e) => pick(s.colour, e)}
            />
          ))}
          <label
            className="backdrop-swatch backdrop-swatch--custom"
            title="Egen färg"
            data-selected={colour !== null && !SWATCHES.some((s) => s.colour === colour) ? 'true' : undefined}
            style={colour && !SWATCHES.some((s) => s.colour === colour) ? { background: colour } : undefined}
          >
            <span aria-hidden="true">+</span>
            <input type="color" aria-label="Egen färg" value={colour ?? lastColour} onChange={(e) => pick(e.currentTarget.value)} />
          </label>
        </div>
      )}

      {tab === 'image' && (
        <div className="backdrop-image">
          <label className="appearance-toggle backdrop-image-choose">
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="backdrop-image-input"
              aria-describedby={error ? 'backdrop-image-error' : undefined}
              onChange={(e) => void onFile(e.currentTarget.files?.[0])}
            />
            {hasImage ? 'Byt bild' : 'Välj bild'}
          </label>
          {hasImage && (
            <button type="button" className="row-action danger" onClick={(e) => void onRemove(e)}>
              Ta bort bild
            </button>
          )}
        </div>
      )}

      {error && (
        <p id="backdrop-image-error" className="backdrop-image-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
