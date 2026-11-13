import { useRef, useState } from 'react'
import { clearBackdrop, readBackdrop, saveBackdrop, type BackdropError } from './backdrop'
import { withBusy } from './motion/busy'

const ERRORS: Record<BackdropError, string> = {
  'not-image': 'Det där är ingen bild. Välj en JPG-, PNG- eller WebP-fil.',
  unreadable: 'Bilden gick inte att läsa. Prova en annan fil.',
  'too-large': 'Bilden fick inte plats i webbläsaren. Prova en mindre bild.',
}

/** Väljer en egen bild bakom glaset, eller går tillbaka till Booqys bakgrund. */
export function BackdropPicker({ id }: { id?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [hasOwn, setHasOwn] = useState(() => readBackdrop() !== null)
  const [error, setError] = useState<string | null>(null)

  async function onPick(file: File | undefined) {
    if (!file) return
    setError(null)
    const err = await withBusy(() => saveBackdrop(file))
    if (err) {
      setError(ERRORS[err])
      input.current?.focus()
    } else {
      setHasOwn(true)
    }
    if (input.current) input.current.value = ''
  }

  return (
    <div className="backdrop-picker">
      <div className="backdrop-picker-actions">
        <label className="appearance-toggle backdrop-picker-choose">
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*"
            className="backdrop-picker-input"
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => void onPick(e.currentTarget.files?.[0])}
          />
          {hasOwn ? 'Byt bild' : 'Välj bild'}
        </label>
        {hasOwn && (
          <button
            type="button"
            className="appearance-toggle"
            onClick={() => {
              clearBackdrop()
              setHasOwn(false)
              setError(null)
            }}
          >
            Booqys bakgrund
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="backdrop-picker-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
