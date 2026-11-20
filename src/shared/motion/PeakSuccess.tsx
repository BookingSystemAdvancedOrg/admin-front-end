import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { play } from '../press'

/** Hur länge det stora kvittot står kvar om ingen trycker bort det. */
export const PEAK_HOLD_MS = 2600
/** Utgången: snabbare än ingången (ux-motion 18). */
const LEAVE_MS = 120

/**
 * Ett avslut som känns (ux-motion 19, topp och slut): en bock som ritas in
 * och en stämpel som slår ned, en gång, under 600 ms, sedan står den still.
 * Samma komponent för alla avslut som räknas:
 *
 * - `size="small"` (standard): på raden där det hände, för det som görs
 *   ofta (en beställning skickad till köket, en bokning sparad). Tyst.
 * - `size="big"`: ett kvitto mitt på skärmen för det som händer sällan
 *   (en kampanj ute hos gästerna, hela Kom igång klart). Ett klick hörs,
 *   ett tryck var som helst stänger, annars går det efter PEAK_HOLD_MS.
 *
 * "Minska rörelse": slutläget tonar in på 150 ms.
 */
export function PeakSuccess({
  text,
  sub,
  size = 'small',
  className,
  announce = true,
}: {
  text: string
  sub?: string
  size?: 'small' | 'big'
  className?: string
  /** false när en omgivande ruta redan är role="status". */
  announce?: boolean
}) {
  return (
    <span className={`peak peak--${size}${className ? ` ${className}` : ''}`} role={announce ? 'status' : undefined}>
      <span className="peak-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M3 8.5 6.5 12 13 4.5" pathLength={24} />
        </svg>
      </span>
      <span>
        <span className="peak-text">{text}</span>
        {sub && <span className="peak-sub">{sub}</span>}
      </span>
    </span>
  )
}

/** Det stora kvittot över sidan. Visa det genom att rendera det; onDone när det gått. */
export function PeakMoment({ text, sub, onDone }: { text: string; sub?: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  }, [onDone])

  useEffect(() => {
    play('cta')
    const hold = window.setTimeout(() => setLeaving(true), PEAK_HOLD_MS)
    return () => window.clearTimeout(hold)
  }, [])

  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(() => done.current(), LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [leaving])

  useEffect(() => {
    const away = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') setLeaving(true)
    }
    window.addEventListener('keydown', away)
    return () => window.removeEventListener('keydown', away)
  }, [])

  return createPortal(
    <div className={`peak-layer${leaving ? ' is-leaving' : ''}`} onPointerDown={() => setLeaving(true)}>
      <PeakSuccess text={text} sub={sub} size="big" />
    </div>,
    document.body,
  )
}
