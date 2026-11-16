import { useEffect, useRef } from 'react'
import { DATA_CHANGED_EVENT } from '../../shared/api'

/**
 * Räknar om när siffrorna kan ha ändrats: direkt efter en skrivning i appen
 * (en ny bokning, en avbokning, en beställning), när fönstret får fokus,
 * fliken blir synlig igen eller nätet är tillbaka, och varje minut medan den
 * syns. Gäller bara när perioden når idag. Summorna räknas på servern, så
 * takten är glesare än listornas 15 s (shared/live.ts).
 */
export function useLiveRefresh(refresh: () => void, on: boolean, everyMs = 60_000) {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })
  useEffect(() => {
    if (!on) return
    const run = () => latest.current()
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener(DATA_CHANGED_EVENT, run)
    window.addEventListener('focus', run)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, everyMs)
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, run)
      window.removeEventListener('focus', run)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [on, everyMs])
}
