import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Bar, Button, Field, Input } from '@booqy/brand'
import { MENU_IMAGE_CONTENT_TYPES, menuImageUrl } from '../meny/menuApi'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { EVENT_IMAGE_ALT_MAX, imageAltError, imageFileError, type EventImage } from './eventImage'

/** Bildväljaren i evenemangsredigeraren: förhandsvisning, byt/ta bort och alt-text. */
export default function EventImageField({ value, onChange, showErrors, note }: {
  value: EventImage; onChange: (next: EventImage) => void; showErrors: boolean
  /** Rad när bilden ändrats på annat håll samtidigt (ChangedNote). */
  note?: ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const legendId = useId()
  const [fileError, setFileError] = useState<string | null>(null)
  // Förhandsvisning av en nyvald fil; frigörs när filen byts eller rutan stängs.
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])
  const preview = value.file && fileUrl ? fileUrl : value.key ? menuImageUrl(value.key) : null

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const problem = imageFileError(file)
    setFileError(problem)
    if (problem) return
    setFileUrl(URL.createObjectURL(file))
    onChange({ ...value, file })
  }

  const hasImage = Boolean(value.key || value.file)
  const altError = showErrors ? imageAltError(value) : null

  return (
    <fieldset className="evenemang-fieldset" aria-labelledby={legendId}>
      <legend className="evenemang-image-legend">
        <span id={legendId}>Bild</span>
        <InfoTooltip label="Bild">AVIF, JPEG, PNG eller WebP, högst 5 MB. Visas på evenemangssidan.</InfoTooltip>
      </legend>
      <div className="evenemang-image">
        {preview ? (
          <img className="evenemang-image-preview" src={preview} alt="" />
        ) : hasImage ? (
          <span className="evenemang-image-preview evenemang-image-empty">Bilden visas på webbplatsen</span>
        ) : (
          <span className="evenemang-image-preview evenemang-image-empty">Ingen bild</span>
        )}
        <div className="evenemang-actions">
          <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            {hasImage ? 'Byt bild' : 'Välj bild'}
          </Button>
          {hasImage ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setFileError(null); setFileUrl(null); onChange({ key: null, file: null, alt: '' }) }}>
              Ta bort bilden
            </Button>
          ) : null}
          <input ref={fileRef} type="file" hidden accept={MENU_IMAGE_CONTENT_TYPES.join(',')} onChange={onPick}
            aria-label="Välj bild till evenemanget" data-testid="event-image-input" />
        </div>
      </div>
      {fileError ? <Bar variant="banner" tone="danger">{fileError}</Bar> : null}
      {hasImage ? (
        <Field label="Bildtext för skärmläsare" required error={altError}>
          <Input value={value.alt} maxLength={EVENT_IMAGE_ALT_MAX} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
        </Field>
      ) : null}
      {note}
    </fieldset>
  )
}
