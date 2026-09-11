import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CATEGORY_LABEL } from './data'
import type { Dish, DishCategory } from './data'
import { validateDishName, validateDishPrice } from './menuApi'

export interface DishFormValues {
  name: string
  description: string
  category: DishCategory
  price: number
  active: boolean
  /**
   * Nyvald bildfil att ladda upp till S3, eller null när bilden inte bytts.
   * Förhandsvisningen i dialogen är en lokal data-URL; den riktiga nyckeln
   * skapas av sidan via uploadMenuImage när rätten sparas.
   */
  imageFile: File | null
}

/**
 * Popup för att lägga till eller redigera en rätt: bild, namn, beskrivning,
 * kategori, pris och aktiv-status. Samma dialog för båda flödena.
 *
 * API:t kräver en bild när en rätt skapas (imageKey är obligatoriskt och
 * kan inte vara tomt), så "Lägg till rätt" är spärrad tills en bild valts.
 * Vid redigering kan bilden bara bytas, inte tas bort — kontraktet tillåter
 * inte en tom imageKey.
 */
export function DishModal({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string
  initial: Dish | null
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
  // Förhandsvisning: befintlig CDN-bild eller data-URL för nyvald fil.
  const [preview, setPreview] = useState<string | null>(initial?.image ?? null)
  const [imageFile, setImageFile] = useState<File | null>(null)
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

  // Tillåt både "195" och "129,50"/"129.50" — API:t tar högst två decimaler.
  const parsedPrice = Number(price.replace(/[^\d.,]/g, '').replace(',', '.'))
  const priceError =
    price.trim() === '' ? 'Pris krävs.' : validateDishPrice(parsedPrice)
  const nameError = validateDishName(name)
  // En helt ny rätt kan inte skapas utan bild (API-kravet); en befintlig
  // rätt har redan sin imageKey och behöver ingen ny fil.
  const imageError =
    !initial && !imageFile ? 'En bild krävs för att skapa rätten.' : null
  const valid = !nameError && !priceError && !imageError

  async function save() {
    if (busy || !valid) return
    setError(null)
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category,
        price: parsedPrice,
        active,
        imageFile,
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
            />
          </div>
        </div>

        <div className="toggle-row">
          <span className="toggle-row-label">
            Aktiv — visas i menyn för gäster
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
