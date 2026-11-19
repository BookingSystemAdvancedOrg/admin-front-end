import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../shared/Icon'
import { dishCount } from './cart'
import type { CartLine } from './cart'
import { DishTile } from './DishTile'
import type { TabMenu, TabMenuItem } from './types'

const ALL = 'alla'

/**
 * The whole active menu, as the guests see it: category tabs in menu order
 * (a rail on monitors), "Alla" and a search ("/" focuses it on keyboards,
 * Enter adds the only match).
 */
export function MenuGrid({
  menu,
  lines,
  onAdd,
  onRemoveOne,
  onEdit,
}: {
  menu: TabMenu
  lines: CartLine[]
  onAdd: (item: TabMenuItem) => void
  onRemoveOne: (item: TabMenuItem) => void
  onEdit: (item: TabMenuItem) => void
}) {
  const [category, setCategory] = useState(ALL)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const stations = useMemo(() => new Map(menu.stations.map((s) => [s.stationId, s])), [menu.stations])
  const categories = menu.categories.filter((c) => menu.items.some((i) => i.categoryId === c.categoryId))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The chosen category can leave the menu (its last dish sold out): show Alla then.
  const cat = category === ALL || categories.some((c) => c.categoryId === category) ? category : ALL
  const q = query.trim().toLowerCase()
  const visible = menu.items.filter(
    (i) => (q ? i.name.toLowerCase().includes(q) : cat === ALL || i.categoryId === cat),
  )
  const sections = q || cat !== ALL
    ? [{ id: 'hits', name: '', items: visible }]
    : categories.map((c) => ({ id: c.categoryId, name: c.name, items: visible.filter((i) => i.categoryId === c.categoryId) }))

  const tile = (item: TabMenuItem) => (
    <DishTile
      key={item.menuItemId}
      item={item}
      count={dishCount(lines, item.menuItemId)}
      station={item.stationId ? stations.get(item.stationId) : undefined}
      onAdd={() => onAdd(item)}
      onRemoveOne={() => onRemoveOne(item)}
      onEdit={() => onEdit(item)}
    />
  )

  return (
    <section className="to-menu" aria-label="Meny">
      <div className="to-menu-bar">
        <label className="to-search">
          <Icon name="search" size={18} />
          <span className="sr-only">Sök rätt</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Sök rätt"
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && visible.length === 1) {
                e.preventDefault()
                onAdd(visible[0]!)
                setQuery('')
              } else if (e.key === 'Escape') {
                setQuery('')
              }
            }}
          />
          <kbd className="to-kbd" aria-hidden="true">/</kbd>
        </label>
        <div className="to-cats" role="tablist" aria-label="Kategorier">
          {[{ categoryId: ALL, name: 'Alla' }, ...categories].map((c) => (
            <button
              key={c.categoryId}
              type="button"
              role="tab"
              aria-selected={!q && cat === c.categoryId}
              className={!q && cat === c.categoryId ? 'active' : ''}
              onClick={() => {
                setQuery('')
                setCategory(c.categoryId)
              }}
            >
              {c.name}
              {c.categoryId !== ALL && <CatCount lines={lines} menu={menu} categoryId={c.categoryId} />}
            </button>
          ))}
        </div>
      </div>
      <div className="to-menu-body">
        {visible.length === 0 ? (
          <p className="cell-muted to-empty">{q ? 'Ingen rätt heter så.' : 'Inga rätter går att beställa just nu.'}</p>
        ) : (
          sections.map((s) =>
            s.items.length === 0 ? null : (
              <section key={s.id} className="to-menu-section" aria-label={s.name || 'Rätter'}>
                {s.name && <h3 className="to-group-title">{s.name}</h3>}
                <div className="to-grid">{s.items.map(tile)}</div>
              </section>
            ),
          )
        )}
      </div>
    </section>
  )
}

function CatCount({ lines, menu, categoryId }: { lines: CartLine[]; menu: TabMenu; categoryId: string }) {
  const ids = new Set(menu.items.filter((i) => i.categoryId === categoryId).map((i) => i.menuItemId))
  const n = lines.filter((l) => ids.has(l.menuItemId)).reduce((sum, l) => sum + l.quantity, 0)
  return n > 0 ? <span className="to-count">{n}</span> : null
}
