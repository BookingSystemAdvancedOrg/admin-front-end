import { useLayoutEffect, useRef } from 'react'
import type { InputHTMLAttributes } from 'react'
import { editPhone, formatPhone } from './phone'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** Numret som det sparas/skickas, helst E.164 ("+46723001573"). */
  value: string
  /** Får alltid E.164 (eller "" för tomt fält). */
  onChange: (value: string) => void
}

/**
 * Telefonfält som formaterar medan man skriver: "0723001573" visas som
 * "+46 72 300 15 73", och onChange får "+46723001573". Samma komponent
 * finns i alla tre apparna (se phone.ts).
 */
export function PhoneInput({ value, onChange, placeholder = '+46 70 123 45 67', ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const display = formatPhone(value)

  // Efter omformateringen: sätt tillbaka markören där användaren skrev.
  useLayoutEffect(() => {
    const el = ref.current
    if (caret.current !== null && el && document.activeElement === el) {
      el.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  })

  return (
    <input
      ref={ref}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={placeholder}
      {...rest}
      value={display}
      onChange={(e) => {
        const next = editPhone(display, e.target.value, e.target.selectionStart ?? e.target.value.length)
        caret.current = next.caret
        onChange(next.value)
      }}
    />
  )
}
