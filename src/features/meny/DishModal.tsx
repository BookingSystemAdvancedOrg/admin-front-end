import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CATEGORY_LABEL } from './data'
import type { Dish, DishCategory } from './data'
import { validateDishName, validateDishPrice } from './menuApi'
import { utcToZonedInput, zonedInputToUtc } from './schedule'

export interface DishFormValues {
  name: string
  description: string
  category: DishCategory
  price: number
  active: boolean
  /** Innehåller alkohol - 25 % moms, kan bara beställas vid bordet. */
  alcohol: boolean
  /**
   * Nyvald bildfil att ladda upp till S3, eller null när bilden inte bytts.
   * Förhandsvisningen i dialogen är en lokal data-URL; den riktiga nyckeln
   * skapas av sidan via uploadMenuImage när rätten sparas.
   */
  imageFile: File | null
  /** Schemat i UTC ("...Z"), null = ingen gräns. */
  availableFrom: string | null
  availableUntil: string | null
}

const GAP_ERROR =
  'Den tiden finns inte (klockan ställs fram en timme vid sommartid). Välj en annan tid.'

/**
 * Inmatat schemafält -> UTC. Oförändrat fält behåller det sparade värdet,
 * så en tid i höstens dubbeltimme eller med sekunder ändras inte av en
 * omöjlig tur-och-retur. undefined = tiden finns inte.
 */
function scheduleValue(
  input: string,
  initialInput: string,
  stored: string | null,
  timeZone: string,
): string | null | undefined {
  if (!input) return null
  if (input === initialInput) return stored
  return zonedInputToUtc(input, timeZone) ?? undefined
}

/**
 * Popup för att lägga till eller redigera en rätt: bild, namn, beskrivning,
 * kategori, pris och aktiv-status. Samma dialog för båda flödena.
 *
 * API:t kräver en bild när en rätt skapas (imageKey är obligatoriskt och
 * kan inte vara tomt), så "Lägg till rätt" är spärrad tills en bild valts.
 * Vid redigering kan bilden bara bytas, inte tas bort - kontraktet tillåter
 * inte en tom imageKey.
 */
export function DishModal({
  title,
  initial,
  timeZone,
  onSave,
  onCancel,
}: {
  title: string
  initial: Dish | null
  /** Platsens tidszon (IANA); schemat matas in och visas i den. */
  timeZone: string
  onSave: (values: DishFormValues) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState<DishCategory>(
    initial?.category ?? 'varmratter',
  )
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [alcohol, setAlcohol] = useState(initial?.alcohol ?? false)
  // Förhandsvisning: befintlig CDN-bild eller data-URL för nyvald fil.
  const [preview, setPreview] = useState<string | null>(initial?.image ?? null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [initialFrom] = useState(() => utcToZonedInput(initial?.availableFrom ?? null, timeZone))
  const [initialUntil] = useState(() => utcToZonedInput(initial?.availableUntil ?? null, timeZone))
  const [openedAt] = useState(() => Date.now())
  const [fromInput, setFromInput] = useState(initialFrom)
  const [untilInput, setUntilInput] = useState(initialUntil)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Stäng med Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => setPreview(String(reader.result))
    reader.readAsDataURL(file)
    // så att samma fil kan väljas igen efter ett byte
    e.target.value = ''
  }

  // Tillåt både "195" och "129,50"/"129.50" - API:t tar högst två decimaler.
  const parsedPrice = Number(price.replace(/[^\d.,]/g, '').replace(',', '.'))
  const priceError =
    price.trim() === '' ? 'Pris krävs.' : validateDishPrice(parsedPrice)
  const nameError = validateDishName(name)
  // En helt ny rätt kan inte skapas utan bild (API-kravet); en befintlig
  // rätt har redan sin imageKey och behöver ingen ny fil.
  const imageError =
    !initial && !imageFile ? 'En bild krävs för att skapa rätten.' : null
  const availableFrom = scheduleValue(fromInput, initialFrom, initial?.availableFrom ?? null, timeZone)
  const availableUntil = scheduleValue(untilInput, initialUntil, initial?.availableUntil ?? null, timeZone)
  const orderError =
    availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom)
      ? 'Slutet måste vara efter starten.'
      : null
  const scheduleWarning =
    !orderError && availableUntil && Date.parse(availableUntil) <= openedAt
      ? 'Sluttiden har redan passerat - rätten visas inte för gäster.'
      : null
  const scheduleValid = availableFrom !== undefined && availableUntil !== undefined && !orderError
  const valid = !nameError && !priceError && !imageError && scheduleValid

  async function save() {
    if (busy || !valid || availableFrom === undefined || availableUntil === undefined) return
    setError(null)
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category,
        price: parsedPrice,
        active,
        alcohol,
        imageFile,
        availableFrom,
        availableUntil,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>

        <div className="form-field">
          <label>{initial ? 'Bild' : 'Bild (krävs)'}</label>
          <div className="dish-upload">
            {preview ? (
              <img
                className="dish-upload-preview"
                src={preview}
                alt="Förhandsvisning"
              />
            ) : (
              <span className="dish-placeholder large" aria-hidden="true">
                🍽
              </span>
            )}
            <div className="dish-upload-actions">
              <button
                type="button"
                className="btn outline square"
                onClick={() => fileRef.current?.click()}
              >
                {preview ? 'Byt bild' : 'Ladda upp bild'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/avif,image/jpeg,image/png,image/webp"
                hidden
                onChange={onPickImage}
              />
            </div>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="dish-name">Namn</label>
          <input
            id="dish-name"
            value={name}
            placeholder="t.ex. Smörstekt Torskrygg"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="dish-description">Beskrivning (frivilligt)</label>
          <input
            id="dish-description"
            value={description}
            placeholder="t.ex. Serveras med brynt smör och pepparrot"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="dish-category">Kategori</label>
            <select
              id="dish-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as DishCategory)}
            >
              {(Object.keys(CATEGORY_LABEL) as DishCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="dish-price">Pris (kr)</label>
            <input
              id="dish-price"
              inputMode="decimal"
              placeholder="t.ex. 195"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={price.trim() !== '' && priceError ? true : undefined}
              aria-describedby={price.trim() !== '' && priceError ? 'dish-price-error' : undefined}
            />
            {price.trim() !== '' && priceError && (
              <p id="dish-price-error" className="form-error">{priceError}</p>
            )}
          </div>
        </div>

        <div className="toggle-row">
          <span className="toggle-row-label">
            Aktiv - visas i menyn för gäster
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label="Aktiv"
            className="switch"
            onClick={() => setActive((a) => !a)}
          />
        </div>

        <div className="toggle-row">
          <span className="toggle-row-label">
            Innehåller alkohol - 25 % moms, kan bara beställas vid bordet
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={alcohol}
            aria-label="Innehåller alkohol"
            className="switch"
            onClick={() => setAlcohol((a) => !a)}
          />
        </div>

        <fieldset className="dish-schedule">
          <legend>Schema (valfritt)</legend>
          <p className="dish-schedule-help">
            Rätten visas för gäster när den är aktiv och tiden är inom schemat. Till-tiden
            räknas inte med: till 14:00 betyder att rätten försvinner 14:00. Tider i{' '}
            {timeZone}.
          </p>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="dish-available-from">Visas från</label>
              <input
                id="dish-available-from"
                type="datetime-local"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                aria-invalid={availableFrom === undefined ? true : undefined}
                aria-describedby={availableFrom === undefined ? 'dish-from-error' : undefined}
              />
              {availableFrom === undefined && (
                <p id="dish-from-error" className="form-error">{GAP_ERROR}</p>
              )}
            </div>
            <div className="form-field">
              <label htmlFor="dish-available-until">Visas till</label>
              <input
                id="dish-available-until"
                type="datetime-local"
                value={untilInput}
                onChange={(e) => setUntilInput(e.target.value)}
                aria-invalid={availableUntil === undefined || orderError ? true : undefined}
                aria-describedby={
                  availableUntil === undefined || orderError ? 'dish-until-error' : undefined
                }
              />
              {(availableUntil === undefined || orderError) && (
                <p id="dish-until-error" className="form-error">
                  {availableUntil === undefined ? GAP_ERROR : orderError}
                </p>
              )}
            </div>
          </div>
          {scheduleWarning && <p className="dish-schedule-warning">{scheduleWarning}</p>}
          {(fromInput || untilInput) && (
            <button
              type="button"
              className="btn outline square"
              onClick={() => {
                setFromInput('')
                setUntilInput('')
              }}
            >
              Rensa schema
            </button>
          )}
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onCancel}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn primary square"
            disabled={!valid || busy}
            onClick={save}
          >
            {busy ? 'Sparar…' : initial ? 'Spara ändringar' : 'Lägg till rätt'}
          </button>
        </div>
      </div>
    </div>
  )
}
