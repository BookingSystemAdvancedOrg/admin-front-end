import { useMemo, useState } from 'react'
import type { Floor } from '../../layout-editor/data'
import { Icon } from '../../../shared/Icon'
import { tableTitle } from '../../../shared/tables'
import { elapsed, FloorMap, hhmm, MAP_STATE_TEXT, tableMapState } from './FloorMap'
import { TableKeypad } from './TableKeypad'
import type { PickerView } from './draft'
import type { Tab, TableState } from './types'

/**
 * Step one of Ny bordsbeställning: which table the guests sit at, so the
 * order (and later the payment in the restaurant's own POS) belongs to the
 * right guests. Map or list, a search on number or guest, and a keypad.
 * A table that already has an open order opens it in add mode.
 */
export function TablePicker({
  tables,
  tabs,
  floors,
  now,
  view,
  onView,
  onPick,
  selectedId,
}: {
  tables: TableState[]
  tabs: Tab[]
  /** null while the plan loads; [] when no geometry (the list is shown). */
  floors: Floor[] | null
  now: number
  view: PickerView
  onView: (view: PickerView) => void
  onPick: (table: TableState) => void
  selectedId?: string | null
}) {
  const [query, setQuery] = useState('')
  const [keypad, setKeypad] = useState(false)
  const hasMap = Boolean(floors && floors.some((f) => f.tables.length > 0))
  const shown: PickerView = hasMap ? view : 'lista'
  const tabById = useMemo(() => new Map(tabs.map((t) => [t.tabId, t])), [tabs])

  const q = query.trim().toLowerCase()
  const matches = (t: TableState) =>
    !q || t.label.toLowerCase() === q || tableTitle(t.label).toLowerCase().includes(q) || (t.guest?.name.toLowerCase().includes(q) ?? false)
      || (t.tabId ? (tabById.get(t.tabId)?.guestName?.toLowerCase().includes(q) ?? false) : false)
  const groups = useMemo(() => {
    const out = new Map<string, { name: string; tables: TableState[] }>()
    for (const t of tables) {
      const g = out.get(t.floorId) ?? { name: t.floorName, tables: [] }
      g.tables.push(t)
      out.set(t.floorId, g)
    }
    return [...out.values()]
  }, [tables])
  const multiFloor = groups.length > 1

  return (
    <section className="to-picker admin-card" aria-labelledby="to-picker-title">
      <header className="to-picker-head">
        <h2 id="to-picker-title" className="to-title">Välj bord</h2>
        <div className="to-picker-tools">
          {hasMap && (
            <div className="to-seg" role="tablist" aria-label="Visa bord som">
              {(['karta', 'lista'] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={shown === v} className={shown === v ? 'active' : ''}
                  onClick={() => onView(v)}>
                  {v === 'karta' ? 'Karta' : 'Lista'}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn outline to-icon-btn" onClick={() => setKeypad(true)} aria-label="Skriv bordsnummer">
            <Icon name="keypad" size={20} />
          </button>
        </div>
      </header>

      {shown === 'karta' && floors ? (
        <FloorMap floors={floors} tables={tables} tabs={tabs} now={now} onPick={onPick} selectedId={selectedId} label="Välj bord" />
      ) : (
        <>
          <label className="to-search">
            <Icon name="search" size={18} />
            <span className="sr-only">Sök bord eller gäst</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Bord eller gäst"
              autoComplete="off" enterKeyHint="search" />
          </label>
          <div className="to-table-list">
            {groups.map((g) => {
              const rows = g.tables.filter(matches)
              if (rows.length === 0) return null
              return (
                <section key={g.name} aria-label={g.name}>
                  {multiFloor && <h3 className="to-group-title">{g.name}</h3>}
                  <ul>
                    {rows.map((t) => {
                      const kind = tableMapState(t)
                      const tab = t.tabId ? tabById.get(t.tabId) : undefined
                      const who = tab?.guestName ?? t.guest?.name
                      const pers = tab?.covers ?? t.guest?.partySize
                      return (
                        <li key={t.tableId}>
                          <button type="button" className={`to-table-row is-${kind}${t.tableId === selectedId ? ' is-selected' : ''}`}
                            onClick={() => onPick(t)}>
                            <span className="to-table-row-name">{tableTitle(t.label)}</span>
                            <span className="to-table-row-who">
                              {who ?? `${t.seats} platser`}
                              {who && pers ? ` · ${pers} pers` : ''}
                              {kind === 'upcoming' && t.guest ? ` · ${hhmm(t.guest.startTime)}` : ''}
                              {tab ? ` · ${elapsed(tab.openedAt, now)}` : ''}
                            </span>
                            <span className={`to-chip to-chip--${kind}`}>{MAP_STATE_TEXT[kind]}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
            {groups.every((g) => g.tables.filter(matches).length === 0) && (
              <p className="cell-muted to-empty">Inget bord heter så.</p>
            )}
          </div>
        </>
      )}
      {keypad && (
        <TableKeypad tables={tables} onClose={() => setKeypad(false)} onPick={(t) => {
          setKeypad(false)
          onPick(t)
        }} />
      )}
    </section>
  )
}
