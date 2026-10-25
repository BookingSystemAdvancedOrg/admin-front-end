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
 * Medan talet räknas upp sätts `--count` (0 till 1, hur långt det kommit)
 * på elementet, så att ett grönt eller rött tal (shared/trend.css) börjar
 * i vanlig textfärg och får sin färg i takt med att siffran växer.
 *
 * `children` är den färdigformaterade texten ("1 250 kr", "12,50 kr",
 * "6,9 %"); prefix och suffix följer med och den sista bildrutan är exakt
 * den strängen, så inget ser annorlunda ut när rörelsen är klar.
 */
/**
 * Hur långt uppräkningen kommit, 0 till 1, mjukt i båda ändar. Färgen följer
 * tiden och inte värdet: värdet rusar till nästan slutet direkt, och då
 * skulle färgen bara blinka till i stället för att växa fram med talet.
 */
function growth(u: number): string {
  const t = Math.min(1, Math.max(0, u))
  return ((1 - Math.cos(Math.PI * t)) / 2).toFixed(3)
}

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
      const u = (now - start) / DURATION_MS
      const p = easeOutExpo(u)
      if (p >= 1) {
        el.textContent = text
        el.style.removeProperty('--count')
        shown.current = to
        finished = true
        raf = 0
        return
      }
      current = from + (to - from) * p
      el.textContent = formatStatValue(parsed, current)
      el.style.setProperty('--count', growth(u))
      raf = requestAnimationFrame(frame)
    }
    el.textContent = formatStatValue(parsed, from)
    el.style.setProperty('--count', growth(0))
    raf = requestAnimationFrame(frame)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.style.removeProperty('--count')
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
    <span ref={ref} className={`count-num${className ? ` ${className}` : ''}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  )
}
