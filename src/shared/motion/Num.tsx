import { useEffect, useRef } from 'react'
import { easeOutExpo, formatStatValue, parseStatValue, reducedMotion } from './countUp'
import { claimReveal, useMotionAllowed } from './MotionScope'

const DURATION_MS = 1100

/**
 * Ett tal som räknas upp när det visas: rusar iväg från noll och saktar in
 * exponentiellt ju närmare det riktiga värdet det kommer. Bara en gång per
 * inloggning: på första sidan efter inloggningen, inom sidans avslöjande
 * (MotionScope). Därefter, och när ett värde ändras senare, står talet bara där.
 *
 * `children` är den färdigformaterade texten ("1 250 kr", "12,50 kr",
 * "6,9 %"); prefix och suffix följer med och den sista bildrutan är exakt
 * den strängen, så inget ser annorlunda ut när rörelsen är klar.
 */
export function Num({ children, className, delayMs = 0 }: { children: string | number; className?: string; delayMs?: number }) {
  const text = String(children)
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)
  const allowed = useMotionAllowed()
  const played = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const parsed = parseStatValue(text)
    if (!parsed || !allowed || played.current || reducedMotion() || !claimReveal()) {
      played.current = true
      el.textContent = text
      shown.current = parsed?.value ?? null
      return
    }
    const from = shown.current ?? 0
    const to = parsed.value
    if (from === to) {
      el.textContent = text
      return
    }
    played.current = true
    const start = performance.now() + delayMs
    let raf = 0
    let finished = false
    let current = from
    const frame = (now: number) => {
      const p = easeOutExpo((now - start) / DURATION_MS)
      if (p >= 1) {
        el.textContent = text
        shown.current = to
        finished = true
        raf = 0
        return
      }
      current = from + (to - from) * p
      el.textContent = formatStatValue(parsed, current)
      raf = requestAnimationFrame(frame)
    }
    el.textContent = formatStatValue(parsed, from)
    raf = requestAnimationFrame(frame)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      // Avbruten innan målet (React StrictMode kör effekten två gånger i
      // utveckling): nästa körning får räkna klart från där den var.
      if (finished) {
        shown.current = to
      } else {
        played.current = false
        shown.current = current
      }
    }
  }, [text, delayMs, allowed])

  // Tal har alltid samma bredd per siffra, så raden inte hoppar medan det räknas.
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  )
}
