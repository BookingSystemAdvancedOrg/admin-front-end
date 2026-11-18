import { useEffect, useRef } from 'react'
import { useUnsavedGuard } from './unsaved'
import './saveBar.css'

/**
 * Spara-raden, samma i hela adminen (ägaren 2026-11-18).
 *
 * - Orört formulär: Spara är avstängd, raden ligger stilla sist i formuläret.
 * - Ändrat (något lagt till, ändrat eller borttaget): raden följer med längst
 *   ner i bild (sticky) med "Ångra ändringar" och Spara, så man aldrig letar
 *   efter knappen. Ändrar man tillbaka blir Spara avstängd igen.
 * - Misslyckat: ändringarna ligger kvar, sidan går till det markerade fältet
 *   (eller felrutan) och knappen heter "Spara igen".
 * - Så länge något är osparat frågar adminen innan man lämnar sidan
 *   (unsaved.ts, LeaveGuard).
 *
 * Utan `onSave` är knappen formulärets submit (eller `form` för en rad
 * utanför formuläret).
 */
export function SaveBar({
  dirty,
  busy = false,
  label = 'Spara',
  onSave,
  onDiscard,
  notice,
  failed = false,
  disabled = false,
  form,
  title,
  className = '',
  guard = true,
}: {
  dirty: boolean
  busy?: boolean
  label?: string
  onSave?: () => void
  onDiscard?: () => void
  /** "Sparat ..." efter en lyckad sparning (visas när inget är osparat). */
  notice?: string | null
  /** Senaste sparningen misslyckades: gå till felet, "Spara igen". */
  failed?: boolean
  /** Går inte att spara alls (inte ägare, data saknas). */
  disabled?: boolean
  form?: string
  title?: string
  className?: string
  /** false: räknas inte som osparat (t.ex. ett nytt tomt formulär). */
  guard?: boolean
}) {
  useUnsavedGuard(guard && dirty)
  const ref = useRef<HTMLDivElement>(null)

  // Ett fel: till fältet som är markerat, annars till felrutan.
  useEffect(() => {
    if (!failed) return
    const scope: ParentNode = (form && document.getElementById(form)) || ref.current?.closest('form, section, .modal') || document
    const field = scope.querySelector<HTMLElement>('[aria-invalid="true"]')
    const note = scope.querySelector<HTMLElement>('.error-note, .form-error, [role="alert"]')
    const target = field ?? note
    if (!target) return
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    if (field) field.focus({ preventScroll: true })
  }, [failed, form])

  const off = disabled || busy || !dirty
  return (
    <div
      ref={ref}
      className={`save-bar${dirty ? ' save-bar--dirty' : ''} ${className}`.trim()}
      data-testid="save-bar"
    >
      <span className="save-bar-status" role="status" aria-live="polite">
        {dirty && !busy ? (
          <>
            <i className="save-bar-dot" aria-hidden="true" />
            Osparade ändringar
          </>
        ) : !dirty && notice ? (
          <span className="save-notice">{notice}</span>
        ) : null}
      </span>
      {dirty && onDiscard && (
        <button type="button" className="btn outline square" disabled={busy} onClick={onDiscard}>
          Ångra ändringar
        </button>
      )}
      <button
        type={onSave ? 'button' : 'submit'}
        form={form}
        className="btn primary square"
        disabled={off}
        title={title}
        onClick={onSave}
      >
        {busy ? 'Sparar…' : failed && dirty ? 'Spara igen' : label}
      </button>
    </div>
  )
}
