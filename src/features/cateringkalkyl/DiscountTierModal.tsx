import { useEffect, useState } from 'react'
import { rangesOverlap } from './data'
import type { DiscountTier } from './data'

export interface DiscountTierFormValues {
  name: string
  fromPortions: number
  toPortions: number | null
  discountPercent: number
  active: boolean
}

/**
 * Popup för att lägga till eller redigera en rabattnivå — samma formulär
 * används för "+ Ny rabattnivå" (initial: null) och "Redigera" (initial satt).
 * Rent lokal validering (ingen server att fråga): två nivåers portionsintervall
 * får aldrig överlappa, annars vore det odefinierat vilken rabatt som gäller.
 */
export function DiscountTierModal({
  title,
  initial,
  otherTiers,
  onSave,
  onCancel,
  onDelete,
}: {
  title: string
  initial: DiscountTier | null
  /** Alla ÖVRIGA nivåer (inte den som redigeras) — för överlappskontrollen. */
  otherTiers: DiscountTier[]
  onSave: (values: DiscountTierFormValues) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [fromPortions, setFromPortions] = useState(
    initial ? String(initial.fromPortions) : '',
  )
  const [toPortions, setToPortions] = useState(
    initial?.toPortions != null ? String(initial.toPortions) : '',
  )
  const [discountPercent, setDiscountPercent] = useState(
    initial ? String(initial.discountPercent) : '',
  )
  const [active, setActive] = useState(initial?.active ?? true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const nameError = name.trim() === '' ? 'Namn krävs.' : null

  const from = Number(fromPortions.replace(/[^\d]/g, ''))
  const fromError =
    fromPortions.trim() === '' || Number.isNaN(from) || from < 1
      ? 'Ange minst 1 portion.'
      : null

  const to = toPortions.trim() === '' ? null : Number(toPortions.replace(/[^\d]/g, ''))
  const toError =
    toPortions.trim() !== '' && (Number.isNaN(to as number) || (to as number) < from)
      ? 'Måste vara minst lika med "Från".'
      : null

  const discount = Number(discountPercent.replace(/[^\d]/g, ''))
  const discountError =
    discountPercent.trim() === '' || Number.isNaN(discount) || discount < 0 || discount > 100
      ? 'Ange 0–100.'
      : null

  const overlap =
    !fromError && !toError
      ? otherTiers.find((t) => rangesOverlap(from, to, t.fromPortions, t.toPortions))
      : undefined

  const valid = !nameError && !fromError && !toError && !discountError && !overlap

  function save() {
    if (!valid) return
    onSave({
      name: name.trim(),
      fromPortions: from,
      toPortions: to,
      discountPercent: discount,
      active,
    })
  }

  return (
    <div
      className="modal-overlay"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p className="modal-subtitle">Samma formulär används för &quot;+ Ny rabattnivå&quot;</p>

        <div className="form-field">
          <label htmlFor="tier-name">Namn på nivå</label>
          <input
            id="tier-name"
            value={name}
            placeholder="t.ex. Nivå 1"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="tier-from">Från antal portioner</label>
            <input
              id="tier-from"
              inputMode="numeric"
              value={fromPortions}
              onChange={(e) => setFromPortions(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="tier-to">Till antal portioner</label>
            <input
              id="tier-to"
              inputMode="numeric"
              value={toPortions}
              onChange={(e) => setToPortions(e.target.value)}
            />
            <p className="field-hint">Lämna tomt = och uppåt</p>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="tier-discount">Rabatt (%)</label>
          <input
            id="tier-discount"
            inputMode="numeric"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
          />
          <p className="field-hint">Dras från delsumman för maten, inte leveransen</p>
        </div>

        <div className="toggle-row">
          <span className="toggle-row-label">Aktiv</span>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label="Aktiv"
            className="switch"
            onClick={() => setActive((a) => !a)}
          />
        </div>

        {overlap ? (
          <p className="form-error" role="alert">
            Överlappar {overlap.name} ({overlap.fromPortions}–
            {overlap.toPortions ?? 'och uppåt'} portioner). Intervallen får inte
            överlappa andra nivåer.
          </p>
        ) : (
          <p className="field-note">Intervallen får inte överlappa andra nivåer.</p>
        )}

        <div className="tier-modal-actions">
          {onDelete && (
            <button type="button" className="link-action danger" onClick={onDelete}>
              Radera nivå
            </button>
          )}
          <span className="row-actions">
            <button type="button" className="btn outline square" onClick={onCancel}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn primary square"
              disabled={!valid}
              onClick={save}
            >
              Spara nivå
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
