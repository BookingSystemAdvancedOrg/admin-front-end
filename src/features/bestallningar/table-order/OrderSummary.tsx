import type { ReactNode, Ref } from 'react'
import { Icon } from '../../../shared/Icon'
import { InfoTooltip } from '../../../shared/InfoTooltip'
import { Num } from '../../../shared/motion/Num'
import { kronor } from '../ordersApi'
import { cartCount, cartTotal, MAX_QTY, sendPreview } from './cart'
import type { CartLine } from './cart'
import { COURSE_LABEL, COURSE_ORDER, TICKET_LABEL } from './courses'
import type { Course, Tab, TabMenu } from './types'

export const TOTAL_TIP = 'Gästen betalar i er egen kassa. Booqy tar inte betalt.'
export const HOLD_TIP = 'Rätterna skickas först när du trycker Skicka.'
export const STATION_TIP = 'Ändra vart en kategori skickas i Meny eller Inställningar > Skrivare.'

/** "Kök och Bar", "Kök, Bar och Pizza" */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} och ${names[names.length - 1]}`
}

/**
 * The order being taken, grouped by course in serving order. Each course
 * goes now ("Skicka nu") or waits ("Vänta") until staff fire it from the
 * Bord view. The footer previews where the tickets go and the reference
 * total ("Att slå in", what staff key into their own POS: never a receipt).
 */
export function OrderSummary({
  head,
  lines,
  hold,
  onHold,
  onQuantity,
  onEdit,
  tab,
  footer,
  bodyRef,
}: {
  head?: ReactNode
  lines: CartLine[]
  hold: Record<Course, boolean>
  onHold: (course: Course, hold: boolean) => void
  onQuantity: (key: string, quantity: number) => void
  onEdit: (key: string) => void
  /** add mode: the open tab, its sent lines are shown read only */
  tab: Tab | null
  footer: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}) {
  const groups = COURSE_ORDER.map((course) => ({ course, lines: lines.filter((l) => l.course === course) })).filter((g) => g.lines.length > 0)
  const sent = tab ? tab.items.filter((i) => i.state !== 'void') : []

  return (
    <div className="to-summary">
      {head && <div className="to-summary-head">{head}</div>}
      <div className="to-summary-body" ref={bodyRef}>
        {tab && sent.length > 0 && (
          <details className="to-sent">
            <summary>
              Redan skickat <span className="to-count">{sent.reduce((n, i) => n + i.quantity, 0)}</span>
            </summary>
            <ul>
              {COURSE_ORDER.flatMap((c) => sent.filter((i) => i.course === c)).map((i) => {
                const round = tab.rounds.find((r) => r.round === i.round)
                const ticket = round?.tickets?.find((t) => t.stationId === i.stationId)
                return (
                  <li key={i.itemId}>
                    <span><strong>{i.quantity} ×</strong> {i.name}</span>
                    <span className={`to-chip to-chip--${i.state === 'held' ? 'held' : ticket?.status ?? 'sent'}`}>
                      {i.state === 'held' ? 'Väntar' : ticket ? TICKET_LABEL[ticket.status] : COURSE_LABEL[i.course]}
                    </span>
                  </li>
                )
              })}
            </ul>
          </details>
        )}
        {groups.length === 0 ? (
          <div className="to-summary-empty">
            <Icon name="dish" size={28} />
            <p className="cell-muted">Tryck på en rätt.</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.course} className={`to-course${hold[g.course] ? ' is-held' : ''}`} aria-label={COURSE_LABEL[g.course]}>
              <header className="to-course-head">
                <h3>{COURSE_LABEL[g.course]}</h3>
                <div className="to-seg to-seg--small" role="radiogroup" aria-label={`${COURSE_LABEL[g.course]}: när`}>
                  <button type="button" role="radio" aria-checked={!hold[g.course]} className={!hold[g.course] ? 'active' : ''}
                    onClick={() => onHold(g.course, false)}>
                    Skicka nu
                  </button>
                  <button type="button" role="radio" aria-checked={hold[g.course]} className={hold[g.course] ? 'active' : ''}
                    onClick={() => onHold(g.course, true)}>
                    Vänta
                  </button>
                </div>
              </header>
              <ul className="to-lines">
                {g.lines.map((l) => (
                  <li key={l.key} className="to-line">
                    <div className="to-stepper to-stepper--line" role="group" aria-label={`Antal ${l.name}`}>
                      <button type="button" aria-label={l.quantity === 1 ? `Ta bort ${l.name}` : `En ${l.name} mindre`}
                        onClick={() => onQuantity(l.key, l.quantity - 1)}>
                        <Icon name={l.quantity === 1 ? 'trash' : 'minus'} size={18} />
                      </button>
                      <output>{l.quantity}</output>
                      <button type="button" aria-label={`En ${l.name} till`} disabled={l.quantity >= MAX_QTY}
                        onClick={() => onQuantity(l.key, l.quantity + 1)}>
                        <Icon name="plus" size={18} />
                      </button>
                    </div>
                    <button type="button" className="to-line-main" onClick={() => onEdit(l.key)} aria-label={`Ändra ${l.name}`}>
                      <span className="to-line-name">{l.name}</span>
                      {(l.options.length > 0 || l.note || l.allergy) && (
                        <span className="to-line-extra">
                          {[...l.options.map((o) => o.choice), l.note].filter(Boolean).join(' · ')}
                          {l.allergy && <span className="to-allergy-tag">Allergi</span>}
                        </span>
                      )}
                    </button>
                    <span className="to-line-price">{kronor(l.unitPrice * l.quantity)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <div className="to-summary-foot">{footer}</div>
    </div>
  )
}

/** "Skickas till Kök 3 · Bar 2", "Väntar: Varmrätt 2" and "Att slå in". */
export function SendPreview({ lines, hold, menu }: { lines: CartLine[]; hold: Record<Course, boolean>; menu: TabMenu | null }) {
  const preview = sendPreview(lines, hold, menu)
  return (
    <div className="to-preview">
      {preview.now.length > 0 && (
        <div className="to-preview-row">
          <span className="to-label">Skickas till</span>
          <span className="to-preview-chips">
            {preview.now.map((s) => (
              <span key={s.stationId} className="to-dest" data-stations={s.stationId}>
                <Icon name={s.stationId === 'bar' || /bar|dryck/i.test(s.name) ? 'glass' : 'tool-kitchen'} size={14} />
                {s.name} <strong>{s.quantity}</strong>
              </span>
            ))}
          </span>
          <InfoTooltip label="Skickas till">{STATION_TIP}</InfoTooltip>
        </div>
      )}
      {preview.waiting.length > 0 && (
        <div className="to-preview-row">
          <span className="to-label">Väntar</span>
          <span className="to-preview-wait">{preview.waiting.map((w) => `${COURSE_LABEL[w.course]} ${w.quantity}`).join(' · ')}</span>
          <InfoTooltip label="Vänta">{HOLD_TIP}</InfoTooltip>
        </div>
      )}
      <div className="to-preview-row to-total">
        <span className="to-label">Att slå in</span>
        <InfoTooltip label="Att slå in">{TOTAL_TIP}</InfoTooltip>
        <span className="to-total-sum">
          <span className="cell-muted">{cartCount(lines)} st · </span>
          <Num>{kronor(cartTotal(lines))}</Num>
        </span>
      </div>
    </div>
  )
}
