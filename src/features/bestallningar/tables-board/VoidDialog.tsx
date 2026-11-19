import { useState } from 'react'
import type { Tab, VoidReason } from '../table-order/types'
import { COURSE_LABEL, COURSE_ORDER } from '../table-order/courses'
import { Icon } from '../../../shared/Icon'
import { ErrorNote } from '../../../shared/ErrorNote'
import type { ErrorInfo } from '../../../shared/errors'
import { BoardDialog } from './BoardDialog'
import { tabTitle, VOID_REASONS } from './tabState'


const NOTE_MAX = 140

/**
 * Makulera: pick the sent dishes (and how many of each) that should not be
 * made, and why. The stations get a MAKULERAD ticket; the amount to key in
 * drops. Held dishes are not listed: they were never sent.
 */
export function VoidDialog({
  tab,
  error,
  errorInfo,
  onCancel,
  onConfirm,
}: {
  tab: Tab
  error?: string | null
  errorInfo?: ErrorInfo
  onCancel: () => void
  onConfirm: (items: { itemId: string; quantity: number }[], reason: VoidReason, note?: string) => Promise<void>
}) {
  const sent = tab.items
    .filter((i) => i.state === 'sent')
    .sort((a, b) => COURSE_ORDER.indexOf(a.course) - COURSE_ORDER.indexOf(b.course))
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<VoidReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // Clamped: after a 409 the fresh tab may have fewer of a dish left than was picked.
  const picked = sent
    .map((i) => ({ itemId: i.itemId, quantity: Math.min(qty[i.itemId] ?? 0, i.quantity) }))
    .filter((p) => p.quantity > 0)
  const count = picked.reduce((s, p) => s + p.quantity, 0)

  function step(itemId: string, max: number, by: number) {
    setQty((q) => ({ ...q, [itemId]: Math.min(max, Math.max(0, Math.min(q[itemId] ?? 0, max) + by)) }))
  }

  async function confirm() {
    if (busy || !reason || !picked.length) return
    setBusy(true)
    try {
      await onConfirm(picked, reason, note.trim() || undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BoardDialog
      title={`Makulera på ${tabTitle(tab)}`}
      onClose={onCancel}
      className="void-dialog"
      actions={
        <>
          <button type="button" className="btn outline square" disabled={busy} onClick={onCancel}>Avbryt</button>
          <button type="button" className="btn danger-outline square board-main-btn" disabled={busy || !reason || !count}
            onClick={() => void confirm()}>
            {count ? `Makulera ${count}` : 'Makulera'}
          </button>
        </>
      }
    >
      {sent.length === 0 ? (
        <p className="cell-muted">Inget är skickat än.</p>
      ) : (
        <ul className="void-list" aria-label="Skickat">
          {sent.map((i) => {
            const n = Math.min(qty[i.itemId] ?? 0, i.quantity)
            return (
              <li key={i.itemId} className={n ? 'picked' : ''}>
                <span className="void-name">
                  {i.name}
                  <span className="cell-muted"> · {COURSE_LABEL[i.course]} · {i.quantity} st</span>
                </span>
                <span className="board-stepper" role="group" aria-label={`Antal ${i.name}`}>
                  <button type="button" className="btn outline square" aria-label={`En färre ${i.name}`}
                    disabled={n === 0} onClick={() => step(i.itemId, i.quantity, -1)}>
                    <Icon name="minus" size={16} />
                  </button>
                  <output aria-live="polite">{n}</output>
                  <button type="button" className="btn outline square" aria-label={`En till ${i.name}`}
                    disabled={n === i.quantity} onClick={() => step(i.itemId, i.quantity, 1)}>
                    <Icon name="plus" size={16} />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <div className="board-chips" role="radiogroup" aria-label="Varför">
        {VOID_REASONS.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={reason === r.id}
            className={`board-chip${reason === r.id ? ' active' : ''}`} onClick={() => setReason(r.id)}>
            {r.label}
          </button>
        ))}
      </div>
      {reason === 'other' && (
        <div className="form-field">
          <label htmlFor="void-note">Notering</label>
          <input id="void-note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
      <ErrorNote text={error} info={errorInfo} />
    </BoardDialog>
  )
}
