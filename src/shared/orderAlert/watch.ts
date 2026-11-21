import { useEffect } from 'react'
import { listOrders } from '../../features/bestallningar/ordersApi'
import { backoffMs, dedupe, subscribeLive } from '../live'
import { feedOrders, ordersKey, pageFedAt } from './store'

/** Hur ofta skalet frågar efter nya beställningar när fliken syns (som Beställningar). */
export const ALERT_POLL_MS = 10_000
/** Dold flik (en annan flik, skrivbordsappen i bakgrunden): mer sällan, men ljudet hörs ändå. */
export const ALERT_HIDDEN_POLL_MS = 60_000

/** Matar en sida listan (Beställningar, var tionde sekund) väntar skalet så här länge efter den senaste. */
const PAGE_GRACE_MS = ALERT_POLL_MS + 1500

/**
 * Skalets egen koll på nya beställningar, på varje sida. Medan
 * Beställningar är öppen och själv hämtar listan (och matar larmet) hämtar
 * skalet inget, så listan hämtas aldrig två gånger; slutar sidan tar skalet
 * över inom ett par sekunder. Direkt vid fokus, synlig flik och när nätet
 * är tillbaka; ett fel väntar längre till nästa.
 */
export function useOrderWatch(locationId: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !locationId) return
    let stopped = false
    let running = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
    const schedule = (ms?: number) => {
      if (timer !== null) clearTimeout(timer)
      if (stopped) return
      const base = hidden() ? ALERT_HIDDEN_POLL_MS : ALERT_POLL_MS
      timer = setTimeout(() => void tick(), ms ?? Math.max(base, backoffMs(failures)))
    }
    const tick = async () => {
      if (stopped || running) return
      const page = pageFedAt(locationId)
      if (Date.now() - page < PAGE_GRACE_MS) {
        schedule(Math.max(1000, page + PAGE_GRACE_MS - Date.now()))
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        schedule()
        return
      }
      running = true
      try {
        const list = await dedupe(ordersKey(locationId), () => listOrders(locationId))
        if (!stopped) feedOrders(locationId, list.orders, 'other')
        failures = 0
      } catch {
        failures += 1
      } finally {
        running = false
      }
      schedule()
    }
    void tick()
    const unsubscribe = subscribeLive((reason) => {
      if (reason === 'focus' || reason === 'online') void tick()
    })
    return () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      unsubscribe()
    }
  }, [locationId, enabled])
}
