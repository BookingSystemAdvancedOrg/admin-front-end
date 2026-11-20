import { useEffect, useState } from 'react'
import { Modal } from '@booqy/brand'
import { tableTitle } from '../../../shared/tables'
import type { TableState } from './types'

/**
 * Quick entry for waiters who know the numbers: type "12", OK, and the
 * order is on Bord 12. Works with the on-screen pad and a keyboard.
 */
export function TableKeypad({
  tables,
  onPick,
  onClose,
}: {
  tables: TableState[]
  onPick: (table: TableState) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  function press(d: string) {
    setError(null)
    setTyped((t) => (t.length >= 4 ? t : t + d))
  }

  function back() {
    setError(null)
    setTyped((t) => t.slice(0, -1))
  }

  function submit(value = typed) {
    const hit = tables.find((t) => t.label === value) ?? tables.find((t) => t.label.toLowerCase() === value.toLowerCase())
    if (!hit) {
      setError(value ? `${tableTitle(value)} finns inte. Kolla numret.` : 'Skriv bordets nummer.')
      return
    }
    onPick(hit)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        back()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    // re-registered every render, so `typed` here is always the current value
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <Modal open title="Bordsnummer" onClose={onClose} closeLabel="Stäng">
      <div className="to-keypad">
        <output className={`to-keypad-display${error ? ' is-error' : ''}`} aria-live="polite">
          {typed ? tableTitle(typed) : 'Bord'}
        </output>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="to-keypad-keys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="to-key" onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="to-key to-key--muted" onClick={back} aria-label="Radera en siffra" disabled={!typed}>
            Radera
          </button>
          <button type="button" className="to-key" onClick={() => press('0')}>
            0
          </button>
          <button type="button" className="to-key to-key--ok" onClick={() => submit()} disabled={!typed}>
            OK
          </button>
        </div>
      </div>
    </Modal>
  )
}
