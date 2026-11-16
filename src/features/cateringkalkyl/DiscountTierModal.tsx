import { useEffect, useRef, useState } from 'react'
import { rangesOverlap } from './data'
import type { DiscountTier } from './data'
import ModalOverlay from '../../shared/ModalOverlay'
import { ErrorNote } from '../../shared/ErrorNote'
import { useConfirm } from '../../shared/ConfirmDialog'

export interface DiscountTierFormValues {
  name: string
  fromPortions: number
  toPortions: number | null
  discountPercent: number
  active: boolean
}

/** Högsta rabatt servern godtar (hela procent, shared/catering.py). */
export const MAX_DISCOUNT_PERCENT = 50

/** Ett heltal ur fältet, eller null om det inte är ett ("7,5", "abc"). */
export function wholeNumber(text: string): number | null {
  const t = text.replace(/\s/g, '')
  return /^\d{1,6}$/.test(t) ? Number(t) : null
}

/**
 * Popup för att lägga till eller redigera en rabattnivå - samma formulär
 * används för "+ Ny rabattnivå" (initial: null) och "Redigera" (initial satt).
 * Rent lokal validering (ingen server att fråga): två nivåers gästintervall
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
  /** Alla ÖVRIGA nivåer (inte den som redigeras) - för överlappskontrollen. */
  otherTiers: DiscountTier[]
  /** Sparar; ett fel (text) visas i rutan som står kvar öppen. */
  onSave: (values: DiscountTierFormValues) => Promise<string | null>
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
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Medan nivån sparas går rutan inte att stänga: svaret (fel eller klart) ska synas här.
  const savingRef = useRef(false)
  savingRef.current = saving

  // Ändrat något i formuläret? Då frågar ett klick utanför eller Escape först.
  const snapshot = JSON.stringify([name, fromPortions, toPortions, discountPercent, active])
  const [initialSnapshot] = useState(snapshot)
  const [confirmEl, ask] = useConfirm()
  const closeRef = useRef<() => void>(() => {})
  closeRef.current = () => {
    if (savingRef.current) return
    if (snapshot === initialSnapshot) {
      onCancel()
      return
    }
    void ask({ title: 'Släng ändringarna?', confirmLabel: 'Släng', cancelLabel: 'Fortsätt redigera', danger: true }).then(
      (ok) => ok && onCancel(),
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const nameError = name.trim() === '' ? 'Ange ett namn.' : null

  const from = wholeNumber(fromPortions)
  const fromError = from === null || from < 1 ? 'Ange ett heltal, minst 1.' : null

  const to = toPortions.trim() === '' ? null : wholeNumber(toPortions)
  const toError =
    toPortions.trim() !== '' && (to === null || (from !== null && to < from))
      ? 'Minst lika med Från.'
      : null

  const discount = wholeNumber(discountPercent)
  const discountError =
    discount === null || discount > MAX_DISCOUNT_PERCENT
      ? `Ange ett heltal 0-${MAX_DISCOUNT_PERCENT}.`
      : null

  const overlap =
    !fromError && !toError && from !== null
      ? otherTiers.find((t) => rangesOverlap(from, to, t.fromPortions, t.toPortions))
      : undefined

  const valid = !nameError && !fromError && !toError && !discountError && !overlap
  // Ett fält visar sitt fel när något skrivits i det, eller efter Spara.
  const show = (text: string, error: string | null) => (tried || text.trim() !== '' ? error : null)
  const errors = {
    name: tried ? nameError : null,
    from: show(fromPortions, fromError),
    to: toError,
    discount: show(discountPercent, discountError),
  }

  async function save() {
    setTried(true)
    if (saving) return
    if (!valid || from === null || discount === null) {
      // Tillbaka till första fältet som är fel (på telefonen kan felet ligga utanför skärmen).
      const first = nameError ? 'tier-name' : fromError ? 'tier-from' : toError ? 'tier-to'
        : discountError ? 'tier-discount' : overlap ? 'tier-from' : null
      if (first) document.getElementById(first)?.focus()
      return
    }
    setSaving(true)
    setSaveError(null)
    const error = await onSave({
      name: name.trim(),
      fromPortions: from,
      toPortions: to,
      discountPercent: discount,
      active,
    })
    setSaving(false)
    if (error) setSaveError(error)
  }

  return (
    <>
    <ModalOverlay
      onPointerDown={(e) => e.target === e.currentTarget && closeRef.current()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>

        <div className="form-field">
          <label htmlFor="tier-name">Namn på nivå</label>
          <input
            id="tier-name"
            value={name}
            placeholder="t.ex. Nivå 1"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'tier-name-error' : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <p className="field-hint error" id="tier-name-error">{errors.name}</p>}
        </div>

        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="tier-from">Från antal gäster</label>
            <input
              id="tier-from"
              inputMode="numeric"
              value={fromPortions}
              aria-invalid={errors.from ? true : undefined}
              aria-describedby={errors.from ? 'tier-from-error' : undefined}
              onChange={(e) => setFromPortions(e.target.value)}
            />
            {errors.from && <p className="field-hint error" id="tier-from-error">{errors.from}</p>}
          </div>
          <div className="form-field">
            <label htmlFor="tier-to">Till antal gäster</label>
            <input
              id="tier-to"
              inputMode="numeric"
              value={toPortions}
              aria-invalid={errors.to ? true : undefined}
              aria-describedby={errors.to ? 'tier-to-error' : undefined}
              onChange={(e) => setToPortions(e.target.value)}
            />
            {errors.to
              ? <p className="field-hint error" id="tier-to-error">{errors.to}</p>
              : <p className="field-hint">Lämna tomt = och uppåt</p>}
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="tier-discount">Rabatt (%)</label>
          <input
            id="tier-discount"
            inputMode="numeric"
            value={discountPercent}
            aria-invalid={errors.discount ? true : undefined}
            aria-describedby={errors.discount ? 'tier-discount-error' : undefined}
            onChange={(e) => setDiscountPercent(e.target.value)}
          />
          {errors.discount
            ? <p className="field-hint error" id="tier-discount-error">{errors.discount}</p>
            : <p className="field-hint">På maten, inte leveransen</p>}
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
            Överlappar {overlap.name} ({overlap.fromPortions}-
            {overlap.toPortions ?? 'och uppåt'} gäster). Intervallen får inte
            överlappa andra nivåer.
          </p>
        ) : (
          <p className="field-note">Intervallen får inte överlappa andra nivåer.</p>
        )}

        <ErrorNote text={saveError} onRetry={() => void save()} />

        <div className="tier-modal-actions">
          {onDelete && (
            <button type="button" className="link-action danger" disabled={saving} onClick={onDelete}>
              Radera nivå
            </button>
          )}
          <span className="row-actions">
            <button type="button" className="btn outline square" disabled={saving} onClick={onCancel}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn primary square"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Sparar…' : 'Spara nivå'}
            </button>
          </span>
        </div>
      </div>
    </ModalOverlay>
    {confirmEl}
    </>
  )
}
