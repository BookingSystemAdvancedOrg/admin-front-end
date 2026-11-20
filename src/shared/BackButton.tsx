import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import './backButton.css'

/**
 * Den enda tillbaka-knappen: en tydlig sekundär pille med pil åt vänster,
 * överst till vänster på sidan eller kortet (i en dialogs knapprad längst
 * till vänster). `to` blir en länk (ny sida), annars en knapp (steg tillbaka
 * i en guide eller dialog). Lintest: backButton.test.ts.
 */
export function BackButton({
  to,
  onClick,
  children = 'Tillbaka',
  className = '',
  disabled,
  state,
}: {
  to?: string
  /** Skickas med länken (t.ex. e-postadressen till inloggningen). */
  state?: unknown
  onClick?: (e: MouseEvent) => void
  children?: ReactNode
  className?: string
  disabled?: boolean
}) {
  const cls = `btn outline back-btn ${className}`.trim()
  const inner = (
    <>
      <Icon name="arrow-left" size={18} className="back-btn-icon" />
      <span>{children}</span>
    </>
  )
  if (to !== undefined)
    return (
      <Link className={cls} to={to} state={state} onClick={onClick}>
        {inner}
      </Link>
    )
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  )
}
