import type { BusinessHours, Weekday } from '../installningar/locationApi'
import { WEEKDAYS } from '../installningar/locationApi'
import type { StripeStage } from '../../shared/tenant'

/**
 * Ren logik för Översikten — utan React, så den går att testa direkt.
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
    // Ogiltig tidszon i datan — hellre svensk tid än en krasch.
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
  id: 'hours' | 'menu' | 'layout' | 'stripe' | 'staff'
  label: string
  /** null = okänt (data kunde inte hämtas) — visas varken som klart eller ej. */
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
}

/**
 * "Kom igång"-listan: det en ny restaurang behöver göra innan gäster kan
 * boka. Personal ser bara de steg de själva kan påverka.
 */
export function setupSteps(input: SetupInput): SetupStep[] {
  const steps: SetupStep[] = [
    {
      id: 'hours',
      label: 'Lägg in öppettider',
      done: input.hasOpeningHours,
      to: '/installningar',
    },
    {
      id: 'menu',
      label: 'Lägg upp menyn',
      done: input.activeMenuItems === null ? null : input.activeMenuItems > 0,
      to: '/meny',
    },
  ]
  if (!input.isOwner) return steps
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
      to: '/installningar',
    },
  ]
}
