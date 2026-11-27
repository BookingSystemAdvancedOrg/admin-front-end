import { useEffect } from 'react'
import { listOrders } from '../../features/bestallningar/ordersApi'
import { listRequests } from '../../features/catering/cateringApi'
import { LIVE_INTERVAL_MS, backoffMs, dedupe, subscribeLive } from '../live'
import { cateringKey, feedCatering, feedOrders, ordersKey, pageFedAt, pageFedCateringAt } from './store'

/** Hur ofta skalet frågar efter nya beställningar när fliken syns (som Beställningar). */
export const ALERT_POLL_MS = 10_000
/** Dold flik (en annan flik, skrivbordsappen i bakgrunden): mer sällan, men ljudet hörs ändå. */
export const ALERT_HIDDEN_POLL_MS = 60_000

/**
 * Cateringförfrågningar: servern läser hela förfrågningshistoriken för varje
 * anrop, så skalet frågar mer sällan än för beställningar (en ny förfrågan
 * är inte minutkritisk som en bordsbeställning, och ägaren får sms och mejl).
 */
export const CATERING_POLL_MS = 30_000
export const CATERING_HIDDEN_POLL_MS = 120_000

/** Matar en sida listan (Beställningar, var tionde sekund) väntar skalet så här länge efter den senaste. */
const PAGE_GRACE_MS = ALERT_POLL_MS + 1500
/** Catering sidan hämtar var 15:e sekund (useLiveRefresh). */
const CATERING_PAGE_GRACE_MS = LIVE_INTERVAL_MS + 1500


const ORDER_WATCH = {
  pollMs: ALERT_POLL_MS,
  hiddenMs: ALERT_HIDDEN_POLL_MS,
  graceMs: PAGE_GRACE_MS,
  pageFedAt,
  fetchAndFeed: async (locationId: string) => {
    const list = await dedupe(ordersKey(locationId), () => listOrders(locationId))
    feedOrders(locationId, list.orders, 'other')
  },
}

const CATERING_WATCH = {
  pollMs: CATERING_POLL_MS,
  hiddenMs: CATERING_HIDDEN_POLL_MS,
  graceMs: CATERING_PAGE_GRACE_MS,
  pageFedAt: pageFedCateringAt,
  fetchAndFeed: async (locationId: string) => {
    const list = await dedupe(cateringKey(locationId), () => listRequests(locationId, 'requested'))
    feedCatering(locationId, list, 'other')
  },
}

/**
 * Skalets egen koll på nya beställningar, på varje sida. Medan
 * Beställningar är öppen och själv hämtar listan (och matar larmet) hämtar
 * skalet inget, så listan hämtas aldrig två gånger; slutar sidan tar skalet
 * över inom ett par sekunder. Direkt vid fokus, synlig flik och när nätet
 * är tillbaka; ett fel väntar längre till nästa.
 */
function useWatch(
  locationId: string | null,
  enabled: boolean,
  cfg: {
    pollMs: number
    hiddenMs: number
    graceMs: number
    pageFedAt: (locationId: string) => number
    fetchAndFeed: (locationId: string) => Promise<void>
  },
): void {
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
      const base = hidden() ? cfg.hiddenMs : cfg.pollMs
      timer = setTimeout(() => void tick(), ms ?? Math.max(base, backoffMs(failures)))
    }
    const tick = async () => {
      if (stopped || running) return
      const page = cfg.pageFedAt(locationId)
      if (Date.now() - page < cfg.graceMs) {
        schedule(Math.max(1000, page + cfg.graceMs - Date.now()))
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        schedule()
        return
      }
      running = true
      try {
        await cfg.fetchAndFeed(locationId)
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

/** Beställningar: tät koll (tionde sekunden) som Beställningar-sidan. */
export function useOrderWatch(locationId: string | null, enabled: boolean): void {
  useWatch(locationId, enabled, ORDER_WATCH)
}

/** Cateringförfrågningar: glesare koll, och skalet hämtar bara de som väntar (status requested). */
export function useCateringWatch(locationId: string | null, enabled: boolean): void {
  useWatch(locationId, enabled, CATERING_WATCH)
}
