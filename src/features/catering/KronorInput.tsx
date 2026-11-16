import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'

/** "89,50" eller "89.5" -> 89.5; tomt -> 0. Högst två decimaler. */
const KRONOR = /^\d*(?:[.,]\d{0,2})?$/

function show(value: number): string {
  return String(value).replace('.', ',')
}

/**
 * Ett kronorfält med decimaler. Texten som skrivs står kvar som den är
 * ("89," medan man skriver 89,50), och siffran går till `onValue`. Ändras
 * värdet utifrån (ny rad, någon annans offert) visas det nya.
 */
export function KronorInput({
  value,
  onValue,
  ...rest
}: { value: number; onValue: (value: number) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'inputMode'
>) {
  const [text, setText] = useState(() => show(value))
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(show(value))
  }
  return (
    <input
      {...rest}
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/\s/g, '')
        if (!KRONOR.test(raw)) return
        const next = Number(raw.replace(',', '.')) || 0
        setText(raw)
        setSeen(next)
        onValue(next)
      }}
    />
  )
}
