import { useEffect, useState } from 'react'
import { errorText } from '../../shared/errors'
import { Icon } from '../../shared/Icon'
import ModalOverlay from '../../shared/ModalOverlay'
import type { MenuCategoryEntry } from './data'
import { isStaleCategories } from './menuApi'
import { categoryListError, MAX_CATEGORIES, NAME_MAX } from './menuForm'
import type { CategoryRow as Row } from './menuForm'

/**
 * Restaurangens egna kategorier: lägg till, byt namn, flytta upp och ner,
 * ta bort. En kategori med rätter kan inte tas bort (servern säger samma
 * sak); flytta rätterna först. Hela listan sparas på en gång.
 */
export function CategoriesModal({
  categories,
  dishCounts,
  onSave,
  onReload,
  onCancel,
}: {
  categories: MenuCategoryEntry[]
  /** Antal rätter per categoryId. */
  dishCounts: Record<string, number>
  onSave: (rows: Row[]) => Promise<void>
  /** Hämtar den sparade listan igen efter 409 stale_categories (dialogen börjar om). */
  onReload: () => Promise<void>
  onCancel: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => categories.map((c) => ({ ...c })))
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stale, setStale] = useState(false)
  const listError = categoryListError(rows)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  function move(i: number, by: number) {
    setRows((prev) => {
      const next = prev.slice()
      const [row] = next.splice(i, 1)
      next.splice(i + by, 0, row)
      return next
    })
  }

  function add() {
    const name = newName.trim()
    if (!name || rows.length >= MAX_CATEGORIES) return
    setRows((prev) => [...prev, { name }])
    setNewName('')
  }

  async function save() {
    if (busy || listError) return
    setBusy(true)
    setError(null)
    try {
      await onSave(rows.map((r) => ({ ...(r.categoryId ? { categoryId: r.categoryId } : {}), name: r.name.trim() })))
    } catch (err) {
      setStale(isStaleCategories(err))
      setError(errorText(err, 'Kategorierna kunde inte sparas.'))
    } finally {
      setBusy(false)
    }
  }

  async function reload() {
    if (busy) return
    setBusy(true)
    try {
      await onReload()
    } catch (err) {
      setError(errorText(err, 'Kunde inte hämta kategorierna.'))
      setBusy(false)
    }
  }

  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal meny-categories" role="dialog" aria-modal="true" aria-label="Kategorier">
        <h2>Kategorier</h2>
        <p className="cell-muted">
          Ordningen här är ordningen på menyn för gästerna. En kategori med rätter kan inte tas bort.
        </p>
        <ol className="meny-category-list">
          {rows.map((r, i) => {
            const count = r.categoryId ? dishCounts[r.categoryId] ?? 0 : 0
            return (
              <li key={r.categoryId ?? `new-${i}`} className="meny-category-row">
                <div className="form-field">
                  <label htmlFor={`cat-${i}`} className="sr-only">Kategori {i + 1}</label>
                  <input id={`cat-${i}`} value={r.name} maxLength={NAME_MAX}
                    onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                </div>
                <span className="cell-muted meny-category-count">{count} {count === 1 ? 'rätt' : 'rätter'}</span>
                <button type="button" className="btn outline square meny-icon-btn" aria-label={`Flytta ${r.name || 'kategorin'} upp`}
                  disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="arrow-up" size={16} />
                </button>
                <button type="button" className="btn outline square meny-icon-btn" aria-label={`Flytta ${r.name || 'kategorin'} ner`}
                  disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="arrow-down" size={16} />
                </button>
                <button type="button" className="btn outline square meny-icon-btn" aria-label={`Ta bort ${r.name || 'kategorin'}`}
                  title={count ? 'Flytta rätterna till en annan kategori först' : 'Ta bort'}
                  disabled={count > 0 || rows.length === 1}
                  onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}>
                  <Icon name="trash" size={16} />
                </button>
              </li>
            )
          })}
        </ol>
        {rows.length < MAX_CATEGORIES && (
          <div className="meny-category-add">
            <div className="form-field">
              <label htmlFor="cat-new">Ny kategori</label>
              <input id="cat-new" value={newName} maxLength={NAME_MAX} placeholder="Till exempel Pizzor"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    add()
                  }
                }} />
            </div>
            <button type="button" className="btn outline square" disabled={!newName.trim()} onClick={add}>
              <Icon name="plus" size={14} /> Lägg till
            </button>
          </div>
        )}
        {(listError ?? error) && <p className="form-error" role="alert">{listError ?? error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onCancel}>Avbryt</button>
          {stale ? (
            <button type="button" className="btn primary square" disabled={busy} onClick={() => void reload()}>
              Ladda om kategorierna
            </button>
          ) : (
            <button type="button" className="btn primary square" disabled={Boolean(listError) || busy} onClick={() => void save()}>
              {busy ? 'Sparar…' : 'Spara kategorier'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
