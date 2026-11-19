import { useState } from 'react'
import type { Tab, TableState } from '../table-order/types'
import { Icon } from '../../../shared/Icon'
import { ErrorNote } from '../../../shared/ErrorNote'
import type { ErrorInfo } from '../../../shared/errors'
import { BoardDialog } from './BoardDialog'
import { tabTitle } from './tabState'

/**
 * Flytta: the guests moved to another table. Only free tables (no open
 * order) can be chosen; merging two tables is not possible. The kitchen's
 * open tickets get the new table and a FLYTTAD slip.
 */
export function MoveTabDialog({
  tab,
  tables,
  error,
  errorInfo,
  onCancel,
  onConfirm,
}: {
  tab: Tab
  tables: TableState[]
  error?: string | null
  errorInfo?: ErrorInfo
  onCancel: () => void
  onConfirm: (tableId: string) => Promise<void>
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const free = tables.filter((t) => !t.tabId && t.tableId !== tab.tableId)
  const floors = [...new Set(free.map((t) => t.floorName))]
  const target = free.find((t) => t.tableId === picked) ?? null

  async function confirm() {
    if (!target || busy) return
    setBusy(true)
    try {
      await onConfirm(target.tableId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BoardDialog
      title={`Flytta ${tabTitle(tab)}`}
      onClose={onCancel}
      className="move-dialog"
      actions={
        <>
          <button type="button" className="btn outline square" disabled={busy} onClick={onCancel}>Avbryt</button>
          <button type="button" className="btn primary square board-main-btn" disabled={busy || !target}
            onClick={() => void confirm()}>
            {target ? `Flytta till ${/^\d/.test(target.label) ? `bord ${target.label}` : target.label}` : 'Flytta till bord'}
          </button>
        </>
      }
    >
      {free.length === 0 ? (
        <p className="cell-muted">Alla bord har en öppen beställning.</p>
      ) : (
        floors.map((floor) => (
          <section key={floor} className="move-floor" aria-label={floor}>
            {floors.length > 1 && <h3>{floor}</h3>}
            <div className="move-grid" role="radiogroup" aria-label={`Bord, ${floor}`}>
              {free.filter((t) => t.floorName === floor).map((t) => (
                <button key={t.tableId} type="button" role="radio" aria-checked={picked === t.tableId}
                  className={`move-table${picked === t.tableId ? ' active' : ''}${t.guest ? ' booked' : ''}`}
                  onClick={() => setPicked(t.tableId)}>
                  <Icon name={t.seats > 4 ? 'table-square' : 'table-round'} size={18} />
                  <span className="move-table-label">{t.label}</span>
                  <span className="move-table-meta">{t.guest ? t.guest.name : `${t.seats} pl`}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
      <ErrorNote text={error} info={errorInfo} />
    </BoardDialog>
  )
}
