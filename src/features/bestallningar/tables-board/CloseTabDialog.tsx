import { useState } from 'react'
import type { Tab } from '../table-order/types'
import { COURSE_LABEL } from '../table-order/courses'
import { InfoTooltip } from '../../../shared/InfoTooltip'
import { Num } from '../../../shared/motion/Num'
import { ErrorNote } from '../../../shared/ErrorNote'
import type { ErrorInfo } from '../../../shared/errors'
import { kronor } from '../ordersApi'
import { BoardDialog } from './BoardDialog'
import { heldByCourse, PAY_TIP, tabTitle, toEnter } from './tabState'

/**
 * "Stäng Bord 5": the list to key into the restaurant's own POS (never a
 * receipt, never printed), a warning when courses are still held ("Skicka
 * först" or "Stäng ändå") and the one confirm button "Betald i kassan,
 * stäng". Booqy takes no payment; closing only records that the guest
 * paid in the restaurant's own system.
 */
export function CloseTabDialog({
  tab,
  error,
  errorInfo,
  onCancel,
  onConfirm,
  onSendFirst,
}: {
  tab: Tab
  error?: string | null
  errorInfo?: ErrorInfo
  onCancel: () => void
  /** dropHeld: close even though held courses were never sent. */
  onConfirm: (dropHeld: boolean) => Promise<void>
  onSendFirst: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const held = heldByCourse(tab)
  // Held dishes never reached the kitchen: closing anyway drops them, so they are not keyed in.
  const lines = toEnter(tab, { sentOnly: held.length > 0 })
  const total = lines.reduce((s, l) => s + l.amount, 0)
  const title = tabTitle(tab)

  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const empty = tab.items.every((i) => i.state === 'void')
  return (
    <BoardDialog
      title={`Stäng ${title}`}
      onClose={onCancel}
      className="close-tab-dialog"
      actions={
        held.length ? (
          <>
            <button type="button" className="btn outline square" disabled={busy}
              onClick={() => void run(() => onConfirm(true))}>
              Stäng ändå
            </button>
            <button type="button" className="btn primary square board-main-btn" disabled={busy} onClick={() => void run(onSendFirst)}>
              Skicka först
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn outline square" disabled={busy} onClick={onCancel}>Avbryt</button>
            <button type="button" className="btn primary square board-main-btn" disabled={busy}
              onClick={() => void run(() => onConfirm(false))}>
              {empty ? 'Stäng utan beställning' : 'Betald i kassan, stäng'}
            </button>
          </>
        )
      }
    >
      {tab.guestName || tab.covers ? (
        <p className="close-tab-guest">
          {tab.guestName}
          {tab.guestName && tab.covers ? ' · ' : ''}
          {tab.covers ? `${tab.covers} gäster` : ''}
        </p>
      ) : null}
      {held.length > 0 && (
        <p className="tab-warning" role="note">
          {held.map((h) => `${COURSE_LABEL[h.course]} ${h.quantity}`).join(', ')} har inte skickats.
        </p>
      )}
      {lines.length > 0 && (
        <section className="to-enter" aria-label="Att slå in">
          <div className="to-enter-head">
            <h3>Att slå in</h3>
            <InfoTooltip label="Att slå in">{PAY_TIP}</InfoTooltip>
          </div>
          <ul className="to-enter-list">
            {lines.map((l) => (
              <li key={l.key}>
                <span className="to-enter-qty">{l.quantity} ×</span>
                <span className="to-enter-name">{l.name}</span>
                <span className="to-enter-amount">{kronor(l.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="to-enter-total">
            <span>Totalt</span> <Num>{kronor(total)}</Num>
          </p>
        </section>
      )}
      <ErrorNote text={error} info={errorInfo} />
    </BoardDialog>
  )
}
