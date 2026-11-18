import { useEffect, useRef, useState } from 'react'
import { errorText } from '../../shared/errors'
import { Icon } from '../../shared/Icon'
import ModalOverlay from '../../shared/ModalOverlay'
import { useConfirm } from '../../shared/ConfirmDialog'
import type { MenuCategoryEntry } from './data'
import type { MenuCategories } from './menuApi'
import { isConflict } from '../../shared/merge'
import { ChangedNote } from '../../shared/ChangedNote'
import { categoryListError, MAX_CATEGORIES, mergeCategoryRows, NAME_MAX } from './menuForm'
import type { CategoryRow as Row } from './menuForm'
import { ErrorNote } from '../../shared/ErrorNote'
import { InfoTooltip } from '../../shared/InfoTooltip'
import { NO_TICKET, printErrorText } from '../bestallningar/printApi'
import type { TicketRouting } from '../bestallningar/printApi'
import { SendTo } from '../printers/SendTo'
import { categoryStation } from '../printers/kinds'

/**
 * Restaurangens egna kategorier: lägg till, byt namn, flytta upp och ner,
 * ta bort. En kategori med rätter kan inte tas bort (servern säger samma
 * sak); flytta rätterna först. Hela listan sparas på en gång.
 *
 * Sparade någon annan listan under tiden (409) hämtas den senaste och dina
 * ändringar läggs ovanpå (mergeCategoryRows); sparningen görs en gång till.
 * Bara ett namn som bytts på båda hållen stannar, med deras namn under fältet.
 */
export function CategoriesModal({
  categories,
  version,
  dishCounts,
  onSave,
  fetchLatest,
  onCancel,
  routing,
  onRoute,
}: {
  /** Listan som den ser ut nu (hämtas levande medan dialogen är öppen). */
  categories: MenuCategoryEntry[]
  /** Listans version när dialogen öppnades. */
  version: number
  /** Antal rätter per categoryId. */
  dishCounts: Record<string, number>
  onSave: (rows: Row[], version: number) => Promise<void>
  /** Den senaste sparade listan (efter 409). */
  fetchLatest: () => Promise<MenuCategories>
  onCancel: () => void
  /** Bongarna: varje sparad kategori får "Skickas till" (sparas direkt). Saknas = inga beställningar. */
  routing?: TicketRouting
  onRoute?: (categoryId: string, next: string) => Promise<void>
}) {
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routePending, setRoutePending] = useState<Record<string, string>>({})
  async function route(categoryId: string, next: string) {
    if (!onRoute) return
    setRouteError(null)
    setRoutePending((p) => ({ ...p, [categoryId]: next }))
    try {
      await onRoute(categoryId, next)
    } catch (err) {
      setRouteError(printErrorText(err))
    } finally {
      setRoutePending((p) => {
        const rest = { ...p }
        delete rest[categoryId]
        return rest
      })
    }
  }
  // Listan och versionen som dina ändringar utgår från.
  const [base, setBase] = useState<{ categories: MenuCategoryEntry[]; version: number }>(() => ({ categories, version }))
  const [rows, setRows] = useState<Row[]>(() => categories.map((c) => ({ ...c })))
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listError = categoryListError(rows)
  /** Namn som bytts på båda hållen vid sparningen: deras namn per categoryId. */
  const [conflicts, setConflicts] = useState<Record<string, string>>({})
  /** Namnet på annat håll, per categoryId, när det skiljer sig från både utgångsläget och ditt. */
  const changedThere = (id: string | undefined, mine: string): string | null => {
    if (!id) return null
    const clash = conflicts[id]
    if (clash !== undefined) return clash.trim() !== mine.trim() ? clash : null
    const was = base.categories.find((c) => c.categoryId === id)?.name
    const now = categories.find((c) => c.categoryId === id)?.name
    return now !== undefined && was !== undefined && now.trim() !== was.trim() && now.trim() !== mine.trim() ? now : null
  }

  // Ändrade kategorier: ett klick utanför eller Escape frågar först.
  const dirty = newName.trim() !== '' || JSON.stringify(payload(rows)) !== JSON.stringify(payload(base.categories))
  const [confirmEl, ask] = useConfirm()
  const closeRef = useRef<() => void>(() => {})
  closeRef.current = () => {
    if (!dirty) {
      onCancel()
      return
    }
    void ask({ title: 'Släng ändringarna?', confirmLabel: 'Släng', cancelLabel: 'Fortsätt redigera', danger: true }).then(
      (ok) => ok && onCancel(),
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  function payload(list: Row[]) {
    return list.map((r) => ({ ...(r.categoryId ? { categoryId: r.categoryId } : {}), name: r.name.trim() }))
  }

  async function save() {
    if (busy || listError) return
    setBusy(true)
    setError(null)
    try {
      try {
        await onSave(payload(rows), base.version)
      } catch (err) {
        if (!isConflict(err)) throw err
        // Någon annan sparade emellan: lägg dina ändringar ovanpå det senaste.
        const latest = await fetchLatest()
        const merged = mergeCategoryRows(base.categories, rows, latest.categories)
        setBase({ categories: latest.categories, version: latest.version })
        setRows(merged.rows)
        setConflicts(Object.fromEntries(merged.conflicts.map((c) => [c.categoryId, c.theirs])))
        if (merged.conflicts.length) {
          setError('Någon annan bytte namn på samma kategori nyss. Välj namn och spara igen.')
          return
        }
        await onSave(payload(merged.rows), latest.version)
      }
    } catch (err) {
      setError(errorText(err, 'Kategorierna sparades inte.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div className="modal meny-categories" role="dialog" aria-modal="true" aria-label="Kategorier">
        <div className="title-info">
          <h2>Kategorier</h2>
          {routing ? (
            <InfoTooltip label="Skickas till">
              Skickas till: vilken skrivare hela kategorins bongar hamnar på. Ett tryck sparar direkt. En rätt kan välja egen.
            </InfoTooltip>
          ) : null}
        </div>
        <ol className="meny-category-list">
          {rows.map((r, i) => {
            const count = r.categoryId ? dishCounts[r.categoryId] ?? 0 : 0
            return (
              <li key={r.categoryId ?? `new-${i}`} className="meny-category-row">
                <div className="form-field">
                  <label htmlFor={`cat-${i}`} className="sr-only">Kategori {i + 1}</label>
                  <input id={`cat-${i}`} value={r.name} maxLength={NAME_MAX}
                    onChange={(e) => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  {(() => {
                    const there = changedThere(r.categoryId, r.name)
                    return there === null ? null : (
                      <ChangedNote value={there}
                        onUse={() => setRows((prev) => prev.map((x, k) => (k === i ? { ...x, name: there } : x)))} />
                    )
                  })()}
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
                {routing && r.categoryId ? (
                  <div className="meny-category-sendto">
                    <SendTo label={`${r.name || 'Kategorin'} skickas till`} stations={routing.stations} compact
                      disabled={!onRoute}
                      value={routePending[r.categoryId] ?? categoryStation(routing, r.categoryId, r.name) ?? NO_TICKET}
                      onChange={(next) => void route(r.categoryId!, next)} />
                  </div>
                ) : null}
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
        <ErrorNote text={listError ?? error ?? routeError} />
        <div className="modal-actions">
          <button type="button" className="btn outline square" onClick={onCancel}>Avbryt</button>
          <button type="button" className="btn primary square" disabled={Boolean(listError) || busy} onClick={() => void save()}>
            {busy ? 'Sparar…' : 'Spara kategorier'}
          </button>
        </div>
      </div>
    </ModalOverlay>
    {confirmEl}
    </>
  )
}
