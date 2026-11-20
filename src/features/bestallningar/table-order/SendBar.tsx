import { createPortal } from 'react-dom'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../../../shared/Icon'
import { Num } from '../../../shared/motion/Num'
import { kronor } from '../ordersApi'

/**
 * Phones and tablets in portrait: the order lives in a sheet, and this bar
 * at the bottom (above the phone's menu) shows how much is in it and opens
 * it. On tablets the Skicka button is right here too. Rendered in <body>
 * so it stays at the bottom of the screen (the page's glass would make
 * position: fixed relative to the content area).
 */
export function SendBar({
  count,
  total,
  open,
  onToggle,
  send,
  label,
  style,
}: {
  count: number
  total: number
  open: boolean
  onToggle: () => void
  /** The Skicka button (tablets); null on phones. */
  send: ReactNode
  label: string
  style?: CSSProperties
}) {
  return createPortal(
    <div className={`to-sendbar${open ? ' is-open' : ''}`} style={style} role="region" aria-label="Beställning">
      <button type="button" className="to-sendbar-sum" onClick={onToggle} aria-expanded={open} aria-controls="to-sheet">
        <span className="to-sendbar-label">{label}</span>
        <span className="to-sendbar-count">
          {count === 1 ? '1 rätt' : `${count} rätter`} · <Num>{kronor(total)}</Num>
        </span>
        <span className="to-sendbar-open">
          {open ? 'Dölj' : 'Visa'}
          <Icon name="chevron-down" size={16} className={open ? '' : 'to-flip'} />
        </span>
      </button>
      {send}
    </div>,
    document.body,
  )
}
