import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import ModalOverlay from './ModalOverlay'
import { ErrorNote } from './ErrorNote'
import { InfoTooltip } from './InfoTooltip'
import { ApiError } from './api'
import { errorText } from './errors'
import './refundDialog.css'

export interface RefundInput {
  /** Öre. */
  amount: number
  reason?: string
  notifyGuest: boolean
}

/** "1 250 kr", "150,50 kr" från öre. */
export function refundKr(ore: number): string {
  const kr = ore / 100
  return `${kr.toLocaleString('sv-SE', {
    minimumFractionDigits: Number.isInteger(kr) ? 0 : 2,
    maximumFractionDigits: 2,
  })} kr`
}

/** Kronor som gästen skrev ("150", "150,5", "1 250") till öre, eller null. */
export function parseKr(text: string): number | null {
  const clean = text.replace(/\s|kr/gi, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null
  return Math.round(Number(clean) * 100)
}

function krText(ore: number): string {
  return (ore % 100 ? (ore / 100).toFixed(2) : String(ore / 100)).replace('.', ',')
}

/** Serverns koder för återbetalningar (bokning, beställning, catering). */
export const REFUND_ERRORS: Record<string, string> = {
  refund_in_progress: 'En återbetalning pågår redan. Vänta två minuter och försök sedan igen.',
  nothing_to_refund: 'Allt är redan återbetalt. Det finns inget kvar att betala tillbaka.',
  not_refundable: 'Det här går inte att betala tillbaka längre. Nu syns det senaste.',
  not_paid: 'Gästen har inte betalat med kort här, så det finns inget att betala tillbaka.',
  changed_retry: 'Någon betalade nyss tillbaka en del. Kolla beloppet innan du försöker igen.',
  refund_failed: 'Stripe sa nej, så inget har betalats tillbaka. Kolla att det finns pengar i Stripe och försök igen.',
  payment_provider_rejected: 'Stripe sa nej, så inget har betalats tillbaka. Kolla att det finns pengar i Stripe och försök igen.',
  payment_unavailable:
    'Stripe svarar inte just nu. Det är inte ert fel. Vänta två minuter: syns ingen återbetalning här då, försök igen.',
}

/**
 * Återbetala till gästen (bokningsavgift, beställning, catering): belopp
 * (högst det som är kvar), valfri anledning som gästen ser, om gästen ska
 * få ett meddelande, och en röd knapp med beloppet. Bara ägaren får den
 * (sidorna visar knappen för ägaren; servern säger nej till andra).
 */
export function RefundDialog({
  title,
  remaining,
  manual = false,
  canNotify = true,
  note,
  onRefund,
  onDone,
  onClose,
}: {
  title: string
  /** Kvar att återbetala, öre. */
  remaining: number
  /** Betald via bankgiro: restaurangen betalar tillbaka för hand. */
  manual?: boolean
  /** Har gästen mejl eller telefon? */
  canNotify?: boolean
  /** En rad till, t.ex. att presentkortets del bara kommer tillbaka vid avbrott. */
  note?: ReactNode
  onRefund: (input: RefundInput) => Promise<unknown>
  onDone: () => void
  onClose: () => void
}) {
  const id = useId()
  const [amountText, setAmountText] = useState(krText(remaining))
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(canNotify)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLFormElement>(null)
  const busyRef = useRef(false)

  // Nytt "kvar" (listan laddades om, t.ex. efter 409): beloppet följer med.
  const shownRemaining = useRef(remaining)
  useEffect(() => {
    if (shownRemaining.current === remaining) return
    shownRemaining.current = remaining
    setAmountText(krText(remaining))
  }, [remaining])

  const amount = parseKr(amountText)
  const valid = amount !== null && amount >= 1 && amount <= remaining

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    amountRef.current?.focus()
    amountRef.current?.select()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      if (!busyRef.current) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus()
    }
  }, [onClose])

  function trapTab(e: ReactKeyboardEvent) {
    if (e.key !== 'Tab' || !dialogRef.current) return
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>('input, button:not(:disabled)')]
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current) return // dubbelklick
    if (!valid || amount === null) {
      setError(`Beloppet ser fel ut. Skriv ett belopp mellan 0,01 kr och ${refundKr(remaining)}.`)
      amountRef.current?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onRefund({
        amount,
        notifyGuest: canNotify && notify,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      onDone()
    } catch (err) {
      // 402 är kortavslag för debitering; vid återbetalning finns inget kort att byta.
      setError(
        err instanceof ApiError && err.status === 402
          ? REFUND_ERRORS.refund_failed
          : errorText(err, 'Inget betalades tillbaka.', REFUND_ERRORS),
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const shown = valid && amount !== null ? refundKr(amount) : null
  const summary = shown
    ? manual
      ? `${shown} betalas tillbaka för hand till gästen.`
      : `${shown} tillbaka till gästens kort.`
    : null

  return (
    <ModalOverlay onPointerDown={(e) => e.target === e.currentTarget && !busyRef.current && onClose()}>
      <form
        ref={dialogRef}
        className="modal refund-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={trapTab}
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <h2 id={`${id}-title`}>{title}</h2>

        <div className="form-field">
          <label htmlFor={`${id}-amount`}>Belopp (kr)</label>
          <input
            ref={amountRef}
            id={`${id}-amount`}
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            aria-invalid={amountText !== '' && !valid ? true : undefined}
            aria-describedby={`${id}-left`}
            disabled={busy}
            onChange={(e) => setAmountText(e.target.value)}
          />
          <p id={`${id}-left`} className="refund-left">
            Kvar att återbetala <strong>{refundKr(remaining)}</strong>
          </p>
        </div>

        <div className="form-field">
          <label htmlFor={`${id}-reason`}>Anledning (valfri)</label>
          <input
            id={`${id}-reason`}
            maxLength={200}
            placeholder="Visas för gästen"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {canNotify && (
          <label className="check-row refund-check">
            <input type="checkbox" checked={notify} disabled={busy} onChange={(e) => setNotify(e.target.checked)} />
            Meddela gästen
          </label>
        )}

        {note ? <p className="refund-note">{note}</p> : null}

        <div className="refund-summary">
          <p aria-live="polite">{summary ?? 'Ange ett belopp.'}</p>
          {!manual && (
            <InfoTooltip label="Stripes avgift">
              Stripe behåller sin avgift för kortbetalningen även när ni återbetalar. Gästen får tillbaka hela
              beloppet ni anger.
            </InfoTooltip>
          )}
        </div>

        <ErrorNote text={error} />

        <div className="modal-actions">
          <button type="button" className="btn outline square" disabled={busy} onClick={onClose}>
            Avbryt
          </button>
          <button
            type="submit"
            className="btn primary square refund-confirm"
            data-danger="true"
            disabled={busy || !valid}
            aria-busy={busy || undefined}
          >
            {busy ? 'Återbetalar…' : shown ? `Återbetala ${shown}` : 'Återbetala'}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}
