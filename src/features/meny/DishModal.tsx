import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CATEGORY_LABEL } from './data'
import type { Dish, DishCategory } from './data'

export interface DishFormValues {
  name: string
  category: DishCategory
  price: number
  active: boolean
  image: string | null
}

/**
 * Popup för att lägga till eller redigera en rätt: valfri bild, namn,
 * kategori, pris och aktiv-status. Samma dialog för båda flödena.
 */
export function DishModal({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string
  initial: Dish | null
  onSave: (values: DishFormValues) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState<DishCategory>(
    initial?.category ?? 'varmratter',
  )
  const [price, setPrice] = useState(
    initial ? String(initial.price) : '',
  )
  const [active, setActive] = useState(initial?.active ?? true)
  const [image, setImage] = useState<string | null>(initial?.image ?? null)
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
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result))
    reader.readAsDataURL(file)
    // så att samma fil kan väljas igen efter "Ta bort bild"
    e.target.value = ''
  }

  const parsedPrice = Number(price.replace(/[^\d]/g, ''))
  const valid = name.trim().length > 0 && price.trim() !== '' && parsedPrice >= 0

  function save() {
    if (!valid) return
    onSave({
      name: name.trim(),
      category,
      price: parsedPrice,
      active,
      image,
    })
  }

  return (
    <div className="modal-overlay" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>

        <div className="form-field">
          <label>Bild (frivilligt)</label>
          <div className="dish-upload">
            {image ? (
              <img className="dish-upload-preview" src={image} alt="Förhandsvisning" />
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
                {image ? 'Byt bild' : 'Ladda upp bild'}
              </button>
              {image && (
                <button
                  type="button"
                  className="link-action danger"
                  onClick={() => setImage(null)}
                >
                  Ta bort bild
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
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
              inputMode="numeric"
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

        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onCancel}>
            Avbryt
          </button>
          <button
            type="button"
            className="btn primary square"
            disabled={!valid}
            onClick={save}
          >
            {initial ? 'Spara ändringar' : 'Lägg till rätt'}
          </button>
        </div>
      </div>
    </div>
  )
}
