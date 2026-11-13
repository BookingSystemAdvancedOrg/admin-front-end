import type { ReactNode } from 'react'
import { Icon } from './Icon'

/**
 * Det man sällan behöver: ett hopfällt avsnitt med rubrik och en pil som
 * vänder sig. Stängt från början om inget annat sägs; en vanlig
 * <details>, så tangentbord och skärmläsare fungerar utan kod.
 */
export function Disclosure({
  title,
  meta,
  defaultOpen = false,
  id,
  className = '',
  onToggle,
  children,
}: {
  title: ReactNode
  /** Kort text till höger i rubriken (antal, status). */
  meta?: ReactNode
  defaultOpen?: boolean
  id?: string
  className?: string
  /** Anropas när användaren fäller ut eller ihop (t.ex. för att minnas valet). */
  onToggle?: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <details
      className={`ds-acc ${className}`.trim()}
      id={id}
      open={defaultOpen || undefined}
      onToggle={onToggle ? (e) => onToggle(e.currentTarget.open) : undefined}
    >
      <summary className="ds-acc-head">
        <span className="ds-acc-title">{title}</span>
        {meta && <span className="ds-acc-meta">{meta}</span>}
        <Icon name="chevron-down" size={18} className="ds-acc-chevron" />
      </summary>
      <div className="ds-acc-body">{children}</div>
    </details>
  )
}
