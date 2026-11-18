import { useRef } from 'react'
import { Icon } from '../../shared/Icon'
import { NO_TICKET } from '../bestallningar/printApi'
import type { Station } from '../bestallningar/printApi'
import { KIND_ICON, stationKind, stationLabel } from './kinds'
import { flyToPrinter } from './fly'
import './printers.css'

/**
 * "Skickas till": ett tryck väljer var bongen hamnar. Ett chip per station
 * (Kök, Dryck och varje Annat-skrivare) och "Ingen bong". `inherit` är
 * förvalet ("Som kategorin"), med stationen det betyder i texten.
 */
export function SendTo({
  label,
  stations,
  value,
  onChange,
  inherit,
  disabled,
  compact,
}: {
  label: string
  stations: Station[]
  /** Stationens id, "none" eller "" (förvalet när `inherit` finns). */
  value: string
  onChange: (next: string) => void
  /** Förvalet: texten och stationen det ger ("Som kategorin", "kok"). */
  inherit?: { text: string; resolves: string | null }
  disabled?: boolean
  compact?: boolean
}) {
  const group = useRef<HTMLDivElement>(null)
  function pick(next: string, el: HTMLElement) {
    if (disabled || next === value) return
    onChange(next)
    const target = next === '' ? inherit?.resolves : next
    if (target && target !== NO_TICKET) flyToPrinter(el, target)
  }
  const chip = (id: string, text: string, icon: Parameters<typeof Icon>[0]['name'] | null, kind: string) => {
    const on = value === id
    return (
      <button key={id || 'inherit'} type="button" role="radio" aria-checked={on} disabled={disabled}
        className={`sendto-chip sendto-chip--${kind}${on ? ' is-on' : ''}`}
        onClick={(e) => pick(id, e.currentTarget)}>
        {icon ? <Icon name={icon} size={compact ? 14 : 16} /> : null}
        <span>{text}</span>
        {on ? <Icon name="check" size={12} className="sendto-check" /> : null}
      </button>
    )
  }
  const resolved = inherit?.resolves ? stations.find((s) => s.stationId === inherit.resolves) : null
  return (
    <div ref={group} className={`sendto${compact ? ' sendto--compact' : ''}`} role="radiogroup" aria-label={label}>
      {inherit
        ? chip('', resolved ? `${inherit.text} (${stationLabel(resolved)})` : `${inherit.text} (ingen bong)`,
          resolved ? KIND_ICON[stationKind(resolved)] : null, 'inherit')
        : null}
      {stations.map((s) => chip(s.stationId ?? '', stationLabel(s), KIND_ICON[stationKind(s)], stationKind(s)))}
      {chip(NO_TICKET, 'Ingen bong', 'close', 'none')}
    </div>
  )
}

/** Förhandsvisningen: en liten bong som säger var rätten hamnar. */
export function TicketPreview({ station, printers }: { station: Station | null; printers: string[] }) {
  return (
    <div className={`ticket-preview${station ? '' : ' ticket-preview--none'}`} aria-live="polite">
      <Icon name="receipt" size={16} />
      {station ? (
        <span>
          <strong>{stationLabel(station)}</strong>
          {printers.length ? ` · ${printers.join(', ')}` : ' · ingen skrivare än'}
        </span>
      ) : (
        <span><strong>Ingen bong</strong></span>
      )}
    </div>
  )
}
