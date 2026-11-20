import { useEffect, useRef } from 'react'
import type { Course, Tab, TabItem, TabRound } from '../table-order/types'
import { COURSE_LABEL, COURSE_ORDER } from '../table-order/courses'
import { Icon } from '../../../shared/Icon'
import { InfoTooltip } from '../../../shared/InfoTooltip'
import { Num } from '../../../shared/motion/Num'
import { clock, kronor } from '../ordersApi'
import { TICKET_TEXT } from '../printApi'
import { elapsed, fireLabel, heldByCourse, itemTicket, PAY_TIP, tabTitle, VOID_REASONS } from './tabState'

const ROUND_KIND: Record<TabRound['kind'], string> = {
  order: 'Beställning',
  fire: 'Skickad',
  void: 'Makulerad',
  move: 'Flyttad',
}

const HISTORY: Record<string, string> = {
  open: 'Öppnade',
  add: 'Lade till',
  fire: 'Skickade',
  void: 'Makulerade',
  edit: 'Ändrade',
  move: 'Flyttade',
  close: 'Stängde',
  reopen: 'Ångrade stäng',
  redispatch: 'Skickade igen',
}

function itemState(tab: Tab, item: TabItem): { text: string; tone: string } {
  if (item.state === 'held') return { text: 'Väntar', tone: 'held' }
  if (item.state === 'void') {
    const why = VOID_REASONS.find((r) => r.id === item.voidReason)?.label
    return { text: why ? `Makulerad, ${why.toLowerCase()}` : 'Makulerad', tone: 'void' }
  }
  const status = itemTicket(tab, item) ?? 'sent'
  const text = TICKET_TEXT[status]
  return { text: `${item.round ? `Runda ${item.round} · ` : ''}${text[0].toUpperCase()}${text.slice(1)}`, tone: status }
}

/**
 * Everything about one open table: dishes per course with their state,
 * each round's tickets per station, the history (who did what, when) and
 * the actions. A side panel on wide screens, a bottom sheet below.
 */
export function TabDetail({
  tab,
  now,
  busy = false,
  onDismiss,
  onAdd,
  onFire,
  onVoid,
  onMove,
  onClose,
  onRedispatch,
}: {
  tab: Tab
  now: number
  busy?: boolean
  onDismiss: () => void
  onAdd: () => void
  onFire: (course: Course) => void
  onVoid: () => void
  onMove: () => void
  onClose: () => void
  onRedispatch: (round: number) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const title = tabTitle(tab)
  const time = elapsed(tab.openedAt, now)
  const held = heldByCourse(tab)
  const hasSent = tab.items.some((i) => i.state === 'sent')
  const groups = COURSE_ORDER.map((c) => ({ course: c, items: tab.items.filter((i) => i.course === c) })).filter((g) => g.items.length)

  useEffect(() => {
    ref.current?.focus()
  }, [tab.tabId])

  return (
    <aside ref={ref} tabIndex={-1} className="tab-detail" aria-label={`${title}, detaljer`}>
      <header className="tab-detail-head">
        <div>
          <h2>{title}</h2>
          <p className="cell-muted">
            {[tab.guestName, tab.covers ? `${tab.covers} gäster` : null, tab.floorName].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button type="button" className="btn outline square board-dialog-x" aria-label="Stäng detaljerna" onClick={onDismiss}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="tab-detail-meta">
        <span>Öppnad {clock(tab.openedAt)} av {tab.openedByName}</span>
        <span className={time.long ? 'tab-card-time long' : 'tab-card-time'}>{time.stale ? 'Öppen sedan igår' : time.text}</span>
      </p>
      {tab.note && <p className="order-notes">”{tab.note}”</p>}

      <div className="tab-detail-actions">
        <button type="button" className="btn primary square" disabled={busy} onClick={onAdd}>
          <Icon name="plus" size={16} /> Lägg till
        </button>
        {held.map((h) => (
          <button key={h.course} type="button" className="btn outline square" disabled={busy} onClick={() => onFire(h.course)}>
            <Icon name="send" size={16} /> {fireLabel(h.course)}
          </button>
        ))}
        <button type="button" className="btn outline square" disabled={busy || !hasSent} onClick={onVoid}>Makulera</button>
        <button type="button" className="btn outline square" disabled={busy} onClick={onMove}>Flytta</button>
        <button type="button" className="btn outline square" disabled={busy} onClick={onClose}>
          <Icon name="check" size={16} /> Stäng
        </button>
      </div>

      <section className="tab-detail-section" aria-label="Rätter">
        {groups.map((g) => (
          <div key={g.course} className="tab-detail-course">
            <h3>{COURSE_LABEL[g.course]}</h3>
            <ul>
              {g.items.map((i) => {
                const st = itemState(tab, i)
                return (
                  <li key={i.itemId} className={i.state === 'void' ? 'void' : ''}>
                    <span className="tab-item-name">
                      <b>{i.quantity} ×</b> {i.name}
                      {i.options.map((o) => (
                        <span key={`${o.group}-${o.choice}`} className="order-line-note">+ {o.choice}</span>
                      ))}
                      {i.note && <span className="order-line-note">{i.note}</span>}
                      {i.allergy && <span className="order-line-allergy">Allergi</span>}
                    </span>
                    <span className={`tab-item-state tab-item-state--${st.tone}`}>{st.text}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <p className="to-enter-total">
          <span className="title-info">
            Att slå in <InfoTooltip label="Att slå in">{PAY_TIP}</InfoTooltip>
          </span>
          <Num>{kronor(tab.referenceTotal)}</Num>
        </p>
      </section>

      {tab.rounds.length > 0 && (
        <section className="tab-detail-section" aria-label="Rundor">
          <h3>Bongar</h3>
          <ol className="tab-rounds">
            {[...tab.rounds].reverse().map((r) => (
              <li key={r.round}>
                <span className="tab-round-head">
                  <b>Runda {r.round}</b> · {ROUND_KIND[r.kind]}
                  {r.kind === 'move' && r.fromLabel && r.toLabel ? ` ${r.fromLabel} till ${r.toLabel}` : ''}
                  {r.kind === 'fire' && r.courses.length ? ` ${r.courses.map((c) => COURSE_LABEL[c].toLowerCase()).join(', ')}` : ''}
                  <span className="cell-muted"> · {clock(r.at)} · {r.byName}</span>
                </span>
                {!r.dispatched ? (
                  <span className="tab-round-stuck">
                    Inte skickad
                    <button type="button" className="btn outline square" disabled={busy} onClick={() => onRedispatch(r.round)}>
                      Skicka igen
                    </button>
                  </span>
                ) : (
                  <span className="order-stations">
                    {(r.tickets ?? []).map((t) => (
                      <span key={t.stationId} className={`order-station order-station--${t.status}`}>
                        {t.stationName}: {TICKET_TEXT[t.status]}
                      </span>
                    ))}
                    {r.stations.filter((s) => s.fallback).map((s) => (
                      <span key={`fb-${s.stationId}`} className="cell-muted tab-round-fallback">
                        {s.stationName} utskriven i köket
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(tab.history?.length ?? 0) > 0 && (
        <details className="tab-detail-section tab-history">
          <summary>Historik</summary>
          <ol>
            {[...(tab.history ?? [])].reverse().map((h, i) => (
              <li key={i}>
                <span className="cell-muted">{clock(h.at)}</span> {h.byName}: {HISTORY[h.action] ?? h.action}
              </li>
            ))}
          </ol>
        </details>
      )}
    </aside>
  )
}
