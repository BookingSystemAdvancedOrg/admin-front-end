import { useEffect, useRef } from 'react'
import { claimNumberReveal } from './MotionScope'
import { reducedMotion } from './countUp'
import type { TrendTone } from '../trend'

/**
 * Ett grönt tal lyser upp en gång när det landar (efter uppräkningen), som
 * en liten belöning. Samma regel som talen: varje gång sidan visas
 * (MotionScope.claimNumberReveal) och aldrig med "minska rörelse". Rött får
 * ingen rörelse alls. Sätt ref:en på elementet med talet.
 */
export function useTrendPop<T extends HTMLElement>(tone: TrendTone, delayMs = 0) {
  const ref = useRef<T>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || done.current || tone !== 'good') return
    done.current = true
    if (reducedMotion() || !claimNumberReveal()) return
    el.style.animationDelay = `${delayMs}ms`
    el.classList.add('trend-pop')
    const end = () => el.classList.remove('trend-pop')
    el.addEventListener('animationend', end, { once: true })
    return () => el.removeEventListener('animationend', end)
  }, [tone, delayMs])

  return ref
}
