import type { Course, Tab } from '../table-order/types'
import { Icon } from '../../../shared/Icon'
import { Num } from '../../../shared/motion/Num'
import { kronor } from '../ordersApi'
import {
  COURSE_STATE_TEXT,
  courseProgress,
  elapsed,
  fireLabel,
  fireReady,
  nextHeldCourse,
  tabTitle,
  undispatched,
} from './tabState'

/**
 * One open table on the Bord view: the table big, the guest, covers, how
 * long it has been open, a chip per course (Väntar, Skickad, Tillagas,
 * Klar) and the actions a waiter needs at the table: Lägg till, the next
 * held course ("Skicka varmrätt", lit up when the course before is ready)
 * and Stäng. Tapping the card opens the details.
 */
export function TabCard({
  tab,
  now,
  fresh = false,
  busy = false,
  selected = false,
  onOpen,
  onAdd,
  onFire,
  onClose,
}: {
  tab: Tab
  now: number
  fresh?: boolean
  busy?: boolean
  selected?: boolean
  onOpen: (tab: Tab) => void
  onAdd: (tab: Tab) => void
  onFire: (tab: Tab, course: Course) => void
  onClose: (tab: Tab) => void
}) {
  const time = elapsed(tab.openedAt, now)
  const progress = courseProgress(tab)
  const next = nextHeldCourse(tab)
  const ready = fireReady(tab)
  const stuck = undispatched(tab).length > 0
  const title = tabTitle(tab)
  return (
    <article
      className={`tab-card${fresh ? ' fresh' : ''}${selected ? ' selected' : ''}${time.long ? ' long' : ''}`}
      aria-label={`${title}${tab.guestName ? `, ${tab.guestName}` : ''}`}
    >
      <button type="button" className="tab-card-open" onClick={() => onOpen(tab)} aria-label={`Visa ${title}`}>
        <span className="tab-card-head">
          <span className="tab-card-table">{title}</span>
          <span className={`tab-card-time${time.long ? ' long' : ''}`}>
            {time.stale ? 'Öppen sedan igår' : time.text}
          </span>
        </span>
        <span className="tab-card-guest">
          {tab.guestName && <span className="tab-card-name">{tab.guestName}</span>}
          {tab.covers ? (
            <span className="tab-card-covers">
              <Icon name="users" size={14} /> <Num>{String(tab.covers)}</Num>
            </span>
          ) : null}
          {tab.floorName && <span className="cell-muted">{tab.floorName}</span>}
        </span>
        {progress.length > 0 && (
          <span className="tab-courses" aria-label="Rätter">
            {progress.map((p) => (
              <span key={p.course} className={`tab-course tab-course--${p.state}`}>
                {p.label} <b>{p.quantity}</b> · {COURSE_STATE_TEXT[p.state]}
              </span>
            ))}
          </span>
        )}
        {stuck && <span className="tab-card-stuck">Inte skickad</span>}
        <span className="tab-card-total">
          <span className="cell-muted">Att slå in</span> <Num>{kronor(tab.referenceTotal)}</Num>
        </span>
      </button>
      <div className="tab-card-actions">
        <button type="button" className="btn outline square" disabled={busy} onClick={() => onAdd(tab)}>
          <Icon name="plus" size={16} /> Lägg till
        </button>
        {next && (
          <button
            type="button"
            className={`btn ${ready ? 'primary' : 'outline'} square tab-fire${ready ? ' ready' : ''}`}
            disabled={busy}
            onClick={() => onFire(tab, next)}
          >
            <Icon name="send" size={16} /> {fireLabel(next)}
          </button>
        )}
        <button type="button" className="btn outline square tab-card-close" disabled={busy} onClick={() => onClose(tab)}>
          <Icon name="check" size={16} /> Stäng
        </button>
      </div>
    </article>
  )
}
