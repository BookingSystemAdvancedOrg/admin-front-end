import type { BusinessHours, Weekday } from '../installningar/locationApi'
import { WEEKDAYS } from '../installningar/locationApi'
import type { Reservation } from '../bokningar/bookingsApi'
import type { Order } from '../bestallningar/ordersApi'
import type { RequestSummary } from '../catering/cateringApi'
import type { PrintStatus } from '../bestallningar/printApi'
import { STEPS, type Step } from '../phone-agent/setup'
import { SETUP } from '../phone-agent/api'
import type { SetupChecklist, SetupState } from './setupApi'

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

/** Dagens öppettider som text, t.ex. "11:00-14:00, 17:00-22:00" eller "Stängt". */
export function todaysHours(
  hours: BusinessHours | undefined,
  timezone: string | null,
  now: Date = new Date(),
): string {
  const intervals = hours?.[weekdayIn(timezone, now)] ?? []
  if (intervals.length === 0) return 'Stängt'
  return intervals.map((i) => `${i.opensAt}-${i.closesAt}`).join(', ')
}

export function hasAnyOpeningHours(hours: BusinessHours | undefined): boolean {
  return WEEKDAYS.some((d) => (hours?.[d]?.length ?? 0) > 0)
}

export type SetupStepId = 'dpa' | 'hours' | 'menu' | 'printers' | 'layout' | 'stripe' | 'staff' | 'google' | 'phone'

/** Vart varje steg i Kom igång leder. Ett nytt steg från servern utan rad här leder till Översikt. */
export const SETUP_LINKS: Record<SetupStepId, string> = {
  dpa: '/avtal',
  hours: '/installningar#dagar',
  menu: '/meny',
  printers: '/installningar#skrivare',
  layout: '/layout',
  stripe: '/installningar#betalningar',
  staff: '/personal',
  google: '/installningar#google',
  phone: '/telefon?flik=installningar',
}

/** Stegets egna sätt att hoppa över (inte "Hoppa över"-knappen). */
const OWN_SKIP: Partial<Record<SetupStepId, string>> = {
  printers: 'Inga skrivare än',
  google: 'Ingen Google-profil',
}

export interface SetupStep {
  id: SetupStepId
  label: string
  /** true = klart eller överhoppat, false = kvar, null = kunde inte kontrolleras. */
  done: boolean | null
  state: SetupState | null
  skippable: boolean
  /** Överhoppat med "Hoppa över": kan ångras här. */
  skippedHere: boolean
  /** Platsen ett platssteg gäller (för "Hoppa över"). */
  locationId?: string
  /** Överhoppat: texten som visas i stället för "Klart". */
  later?: string
  to: string
  /** Delstegen (telefonassistentens fem steg), visas under raden. */
  sub?: { id: Step; label: string; done: boolean }[]
}

/**
 * Kom igång för den valda platsen ur serverns lista: tenant-steg som de är,
 * platssteg för platsen. Ordningen och etiketterna är serverns, så ett nytt
 * steg syns här utan ändring i admin.
 */
export function stepsFromServer(checklist: SetupChecklist | null, locationId: string | null): SetupStep[] {
  if (!checklist) return []
  return checklist.steps.map((s) => {
    const place = s.scope === 'location' ? s.locations?.find((p) => p.locationId === locationId) : undefined
    const state: SetupState = s.scope === 'location' ? place?.state ?? 'open' : s.state
    const known = s.scope === 'location' ? place?.known ?? false : s.known
    const skippedHere = Boolean(s.scope === 'location' ? place?.skippedHere : s.skippedHere)
    const id = s.id as SetupStepId
    const sub = place?.sub
      ? place.sub
        .filter((x) => (STEPS as string[]).includes(x.id))
        .map((x) => ({ id: x.id as Step, label: SETUP.STEP_LABEL[STEPS.indexOf(x.id as Step)], done: x.done }))
      : undefined
    const next = sub?.find((x) => !x.done)?.id
    const to = id === 'phone' && next ? `${SETUP_LINKS.phone}&steg=${next}` : SETUP_LINKS[id] ?? '/'
    return {
      id,
      label: s.label,
      done: state !== 'open' ? true : known ? false : null,
      state: state !== 'open' || known ? state : null,
      skippable: s.skippable,
      skippedHere,
      ...(s.scope === 'location' && locationId ? { locationId } : {}),
      ...(state === 'skipped' ? { later: skippedHere ? 'Överhoppat' : OWN_SKIP[id] ?? 'Överhoppat' } : {}),
      to,
      ...(sub ? { sub } : {}),
    }
  })
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

/** Dagens omsättning i öre: betalda beställningar som inte avbrutits eller
 * återbetalats helt; en delvis återbetald räknas med det som är kvar. */
export function revenueToday(orders: Order[] | null): { amount: number; count: number } | null {
  if (!orders) return null
  const paid = orders.filter(
    (o) => (o.paymentStatus === 'paid' || o.paymentStatus === 'partly_refunded')
      && o.status !== 'cancelled' && o.status !== 'failed',
  )
  return { amount: paid.reduce((sum, o) => sum + o.totalAmount - (o.refund?.amount ?? 0), 0), count: paid.length }
}

/**
 * Omsättningen i öre en annan dag fram till samma klockslag som nu (platsens
 * tid), så att dagen hittills jämförs rättvist med samma veckodag förra
 * veckan: klockan tolv mot klockan tolv, inte mot hela kvällen.
 * Beställningar utan tid räknas inte.
 */
export function revenueUntil(orders: Order[] | null, nowClock: string, timezone: string | null): number | null {
  if (!orders) return null
  const before = orders.filter((o) => o.createdAt && clockIn(timezone, new Date(o.createdAt)) <= nowClock)
  return revenueToday(before)?.amount ?? 0
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
  id: 'prints' | 'payments' | 'catering' | 'unconfirmed'
  count: number
  label: string
  to: string
}

const CATERING_WAITING = new Set(['requested', 'change_requested'])

/**
 * Att hantera: köksnotor som inte kom ut (köket vet inte om beställningen),
 * misslyckade kortdragningar (avgifter), cateringförfrågningar som väntar på
 * svar och bokningar där gästen inte lagt in kortet än. Det mest brådskande
 * först. Notor som väntar i kön räknas bara när skrivaren inte svarar; annars
 * skrivs de ut inom några sekunder. null = inget gick att hämta.
 */
export function todoQueue(
  today: Reservation[] | null,
  catering: RequestSummary[] | null,
  print: PrintStatus | null = null,
): { total: number; items: TodoItem[] } | null {
  if (!today && !catering) return null
  const notPrinted = print?.printerConfigured ? print.failed + (print.online ? 0 : print.unprinted) : 0
  const failed = (today ?? []).filter((r) => r.payment?.status === 'failed').length
  const waitingCatering = (catering ?? []).filter((c) => CATERING_WAITING.has(c.status)).length
  const unconfirmed = (today ?? []).filter((r) => r.status === 'pending').length
  const items: TodoItem[] = [
    { id: 'prints' as const, count: notPrinted, label: notPrinted === 1 ? 'ej utskriven nota' : 'ej utskrivna notor', to: '/bestallningar' },
    { id: 'payments' as const, count: failed, label: failed === 1 ? 'misslyckad betalning' : 'misslyckade betalningar', to: '/bokningar' },
    { id: 'catering' as const, count: waitingCatering, label: waitingCatering === 1 ? 'cateringförfrågan' : 'cateringförfrågningar', to: '/catering' },
    { id: 'unconfirmed' as const, count: unconfirmed, label: unconfirmed === 1 ? 'obekräftad bokning' : 'obekräftade bokningar', to: '/bokningar' },
  ].filter((i) => i.count > 0)
  return { total: items.reduce((sum, i) => sum + i.count, 0), items }
}
