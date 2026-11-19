import type { Course, Tab, TicketStatus } from './types'

/** Serving order: how lines are grouped in the summary and on tickets. */
export const COURSE_ORDER: readonly Course[] = ['drinks', 'starters', 'mains', 'desserts', 'other']

export const COURSE_LABEL: Record<Course, string> = {
  drinks: 'Dryck',
  starters: 'Förrätt',
  mains: 'Varmrätt',
  desserts: 'Efterrätt',
  other: 'Övrigt',
}

/** The button that fires a held course ("Skicka varmrätt"). */
export const FIRE_LABEL: Record<Course, string> = {
  drinks: 'Skicka dryck',
  starters: 'Skicka förrätt',
  mains: 'Skicka varmrätt',
  desserts: 'Skicka efterrätt',
  other: 'Skicka övrigt',
}

function live(tab: Tab | null, course: Course): boolean {
  return Boolean(tab?.items.some((i) => i.course === course && i.state !== 'void'))
}

/**
 * Starters on the tab that are not on the pass yet: held, or sent while a
 * ticket of their round is not ready (no ticket states known counts as not ready).
 */
export function startersPending(tab: Tab | null): boolean {
  if (!tab) return false
  return tab.items.some((i) => {
    if (i.course !== 'starters' || i.state === 'void') return false
    if (i.state === 'held') return true
    const round = tab.rounds.find((r) => r.round === i.round)
    const tickets = round?.tickets ?? []
    return tickets.length === 0 || tickets.some((t) => t.status !== 'ready' && t.status !== 'cancelled')
  })
}

/**
 * Default "Skicka nu" (false) or "Vänta" (true) per course (spec 4.3):
 * drinks, starters and other go now; mains wait when this send or the tab
 * has starters that are not ready; desserts wait when there are starters or
 * mains in this send or on the tab.
 */
export function defaultHold(cart: readonly Course[], tab: Tab | null): Record<Course, boolean> {
  const inCart = (c: Course) => cart.includes(c)
  return {
    drinks: false,
    starters: false,
    other: false,
    mains: inCart('starters') || startersPending(tab),
    desserts: inCart('starters') || inCart('mains') || live(tab, 'starters') || live(tab, 'mains'),
  }
}

/** Held quantity per course on a tab, in serving order. */
export function heldByCourse(tab: Tab): { course: Course; quantity: number }[] {
  return COURSE_ORDER.map((course) => ({
    course,
    quantity: tab.items.filter((i) => i.state === 'held' && i.course === course).reduce((n, i) => n + i.quantity, 0),
  })).filter((c) => c.quantity > 0)
}

/** A kitchen ticket's state as staff read it (KDS). */
export const TICKET_LABEL: Record<TicketStatus, string> = {
  sent: 'Skickad',
  preparing: 'Tillagas',
  ready: 'Klar',
  cancelled: 'Makulerad',
}
