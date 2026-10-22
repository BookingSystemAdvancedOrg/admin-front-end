import type { BusinessHours, Weekday } from '../installningar/locationApi'
import { WEEKDAYS } from '../installningar/locationApi'
import type { StripeStage } from '../../shared/tenant'
import type { Reservation } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { RequestSummary } from '../catering/cateringApi'

/**
 * Ren logik för Översikten - utan React, så den går att testa direkt.
 * Allt som visas på sidan räknas fram ur riktig data från API:t.
 */

/** Veckodagen "nu" i platsens tidszon (inte webbläsarens). */
export function weekdayIn(timezone: string | null, now: Date = new Date()): Weekday {
  let name: string
  try {
    name = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: timezone || 'Europe/Stockholm',
    }).format(now)
  } catch {
    // Ogiltig tidszon i datan - hellre svensk tid än en krasch.
    name = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      timeZone: 'Europe/Stockholm',
    }).format(now)
  }
  const day = name.toLowerCase() as Weekday
  return WEEKDAYS.includes(day) ? day : 'monday'
}

/** Dagens öppettider som text, t.ex. "11:00–14:00, 17:00–22:00" eller "Stängt". */
export function todaysHours(
  hours: BusinessHours | undefined,
  timezone: string | null,
  now: Date = new Date(),
): string {
  const intervals = hours?.[weekdayIn(timezone, now)] ?? []
  if (intervals.length === 0) return 'Stängt'
  return intervals.map((i) => `${i.opensAt}–${i.closesAt}`).join(', ')
}

export function hasAnyOpeningHours(hours: BusinessHours | undefined): boolean {
  return WEEKDAYS.some((d) => (hours?.[d]?.length ?? 0) > 0)
}

export interface SetupStep {
  id: 'dpa' | 'hours' | 'menu' | 'layout' | 'stripe' | 'staff'
  label: string
  /** null = okänt (data kunde inte hämtas) - visas varken som klart eller ej. */
  done: boolean | null
  to: string
}

export interface SetupInput {
  isOwner: boolean
  hasOpeningHours: boolean | null
  activeMenuItems: number | null
  hasLiveLayout: boolean | null
  stripeStage: StripeStage
  staffCount: number | null
  /** Personuppgiftsbiträdesavtalet: undefined = API:t saknar det (inget steg). */
  dpaAccepted?: boolean
}

/**
 * "Kom igång"-listan: det en ny restaurang behöver göra innan gäster kan
 * boka. Bara för ägaren - personal får inga steg alls.
 */
export function setupSteps(input: SetupInput): SetupStep[] {
  if (!input.isOwner) return []
  const steps: SetupStep[] = [
    // Först: en ny restaurang publiceras inte förrän avtalet är godkänt.
    ...(input.dpaAccepted === undefined
      ? []
      : [{ id: 'dpa' as const, label: 'Godkänn personuppgiftsbiträdesavtalet', done: input.dpaAccepted, to: '/avtal' }]),
    {
      id: 'hours',
      label: 'Lägg in öppettider',
      done: input.hasOpeningHours,
      to: '/installningar#profil',
    },
    {
      id: 'menu',
      label: 'Lägg upp menyn',
      done: input.activeMenuItems === null ? null : input.activeMenuItems > 0,
      to: '/meny',
    },
  ]
  return [
    ...steps,
    {
      id: 'layout',
      label: 'Publicera och aktivera en bordslayout',
      done: input.hasLiveLayout,
      to: '/layout',
    },
    {
      id: 'stripe',
      label: 'Slutför Stripe för kortbetalningar',
      done: input.stripeStage === 'ready',
      to: '/installningar#betalningar',
    },
    {
      id: 'staff',
      label: 'Bjud in personal',
      done: input.staffCount === null ? null : input.staffCount > 0,
      to: '/installningar#personal',
    },
  ]
}

/* --- Nyckeltalen överst på Översikt ---------------------------------------- */

/** "HH:MM" just nu i platsens tidszon. */
export function clockIn(timezone: string | null, now: Date = new Date()): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now)
  try {
    return fmt(timezone || 'Europe/Stockholm')
  } catch {
    return fmt('Europe/Stockholm')
  }
}

const ACTIVE_RESERVATION = new Set(['pending', 'reserved', 'arrived'])

/** Bokningar idag: antal, gäster och nästa gäst som ska komma (inte anlänt). */
export function bookingsToday(
  today: Reservation[] | null,
  nowClock: string,
): { count: number; guests: number; next: Reservation | null } | null {
  if (!today) return null
  const active = today.filter((r) => ACTIVE_RESERVATION.has(r.status))
  const upcoming = active
    .filter((r) => r.status !== 'arrived' && r.startTime >= nowClock)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  return {
    count: active.length,
    guests: active.reduce((sum, r) => sum + r.partySize, 0),
    next: upcoming[0] ?? null,
  }
}

/** Dagens omsättning i öre: betalda beställningar som inte avbrutits eller återbetalats. */
export function revenueToday(orders: Order[] | null): { amount: number; count: number } | null {
  if (!orders) return null
  const paid = orders.filter(
    (o) => o.paymentStatus === 'paid' && o.status !== 'cancelled' && o.status !== 'failed',
  )
  return { amount: paid.reduce((sum, o) => sum + o.totalAmount, 0), count: paid.length }
}

const IN_PROGRESS = new Set(['confirmed', 'preparing', 'ready'])

/** Aktiva beställningar: betalda men inte klara/hämtade. */
export function activeOrders(
  orders: Order[] | null,
): { count: number; fresh: number; preparing: number; ready: number } | null {
  if (!orders) return null
  const active = orders.filter((o) => IN_PROGRESS.has(o.status))
  return {
    count: active.length,
    fresh: active.filter((o) => o.status === 'confirmed').length,
    preparing: active.filter((o) => o.status === 'preparing').length,
    ready: active.filter((o) => o.status === 'ready').length,
  }
}

/** Det som väntar på personalen, i den ordning det bör tas. */
export interface TodoItem {
  id: 'payments' | 'catering' | 'unconfirmed'
  count: number
  label: string
  to: string
}

const CATERING_WAITING = new Set(['requested', 'change_requested'])

/**
 * Att hantera: misslyckade kortdragningar (avgifter), cateringförfrågningar
 * som väntar på svar och bokningar där gästen inte lagt in kortet än.
 * Det mest brådskande först. null = inget gick att hämta.
 */
export function todoQueue(
  today: Reservation[] | null,
  catering: RequestSummary[] | null,
): { total: number; items: TodoItem[] } | null {
  if (!today && !catering) return null
  const failed = (today ?? []).filter((r) => r.payment?.status === 'failed').length
  const waitingCatering = (catering ?? []).filter((c) => CATERING_WAITING.has(c.status)).length
  const unconfirmed = (today ?? []).filter((r) => r.status === 'pending').length
  const items: TodoItem[] = [
    { id: 'payments' as const, count: failed, label: failed === 1 ? 'misslyckad betalning' : 'misslyckade betalningar', to: '/bokningar' },
    { id: 'catering' as const, count: waitingCatering, label: waitingCatering === 1 ? 'cateringförfrågan' : 'cateringförfrågningar', to: '/catering' },
    { id: 'unconfirmed' as const, count: unconfirmed, label: unconfirmed === 1 ? 'obekräftad bokning' : 'obekräftade bokningar', to: '/bokningar' },
  ].filter((i) => i.count > 0)
  return { total: items.reduce((sum, i) => sum + i.count, 0), items }
}
