import { useEffect, useRef } from 'react'
import { easeOutExpo, formatStatValue, parseStatValue, reducedMotion } from './countUp'

const DURATION_MS = 1100

/**
 * Ett tal som räknas upp när det visas: rusar iväg från noll och saktar in
 * exponentiellt ju närmare det riktiga värdet det kommer. Ändras värdet
 * senare (en lista hämtas om) räknar det från det gamla till det nya.
 *
 * `children` är den färdigformaterade texten ("1 250 kr", "12,50 kr",
 * "6,9 %"); prefix och suffix följer med och den sista bildrutan är exakt
 * den strängen, så inget ser annorlunda ut när rörelsen är klar.
 */
export function Num({ children, className, delayMs = 0 }: { children: string | number; className?: string; delayMs?: number }) {
  const text = String(children)
  const ref = useRef<HTMLSpanElement>(null)
  const shown = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const parsed = parseStatValue(text)
    if (!parsed || reducedMotion()) {
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
    const start = performance.now() + delayMs
    let raf = 0
    const frame = (now: number) => {
      const p = easeOutExpo((now - start) / DURATION_MS)
      if (p >= 1) {
        el.textContent = text
        shown.current = to
        raf = 0
        return
      }
      el.textContent = formatStatValue(parsed, from + (to - from) * p)
      raf = requestAnimationFrame(frame)
    }
    el.textContent = formatStatValue(parsed, from)
    raf = requestAnimationFrame(frame)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      shown.current = to
    }
  }, [text, delayMs])

  // Tal har alltid samma bredd per siffra, så raden inte hoppar medan det räknas.
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  )
}
