import type { Course, Tab, TabItem, TicketStatus, VoidReason } from '../table-order/types'
import { COURSE_LABEL, COURSE_ORDER } from '../table-order/courses'
import { tableTitle } from '../../../shared/tables'

/**
 * Pure helpers for the Bord view: what each course of an open table order
 * is doing right now (held, sent, being cooked, ready), the next course to
 * fire, how long the table has been open and the "Att slå in" list.
 * Nothing here is a receipt: the list is only what staff key into the
 * restaurant's own POS.
 */

export { addToTabPath as addPath } from '../table-order/links'
export const NEW_ORDER_PATH = '/bestallningar/bord/ny'

export const PAY_TIP = 'Gästen betalar i er egen kassa. Booqy tar inte betalt.'

export const VOID_REASONS: { id: VoidReason; label: string }[] = [
  { id: 'wrong', label: 'Fel registrerad' },
  { id: 'guest_changed', label: 'Gästen ändrade sig' },
  { id: 'other', label: 'Annat' },
]

export type CourseState = 'held' | 'sent' | 'preparing' | 'ready'

export const COURSE_STATE_TEXT: Record<CourseState, string> = {
  held: 'Väntar',
  sent: 'Skickad',
  preparing: 'Tillagas',
  ready: 'Klar',
}

export interface CourseProgress {
  course: Course
  label: string
  state: CourseState
  quantity: number
}

const live = (i: TabItem) => i.state !== 'void'

/** The ticket status of one sent item (its round, its station); no ticket = sent. */
export function itemTicket(tab: Tab, item: TabItem): TicketStatus | null {
  if (item.state !== 'sent' || !item.round) return null
  const round = tab.rounds.find((r) => r.round === item.round)
  const ticket = round?.tickets?.find((t) => t.stationId === item.stationId)
  return ticket?.status ?? 'sent'
}

/** One chip per course in serving order: Väntar, Skickad, Tillagas or Klar. */
export function courseProgress(tab: Tab): CourseProgress[] {
  const out: CourseProgress[] = []
  for (const course of COURSE_ORDER) {
    const items = tab.items.filter((i) => live(i) && i.course === course)
    if (!items.length) continue
    const quantity = items.reduce((s, i) => s + i.quantity, 0)
    let state: CourseState
    if (items.some((i) => i.state === 'held')) state = 'held'
    else {
      const statuses = items.map((i) => itemTicket(tab, i)).filter((s) => s !== 'cancelled')
      if (statuses.length && statuses.every((s) => s === 'ready')) state = 'ready'
      else if (statuses.some((s) => s === 'preparing' || s === 'ready')) state = 'preparing'
      else state = 'sent'
    }
    out.push({ course, label: COURSE_LABEL[course], state, quantity })
  }
  return out
}

/** Held items per course, in serving order ("Varmrätt 4"). */
export function heldByCourse(tab: Tab): { course: Course; quantity: number }[] {
  return COURSE_ORDER.map((course) => ({
    course,
    quantity: tab.items.filter((i) => i.state === 'held' && i.course === course).reduce((s, i) => s + i.quantity, 0),
  })).filter((c) => c.quantity > 0)
}

/** The first course still waiting in the kitchen's serving order, or null. */
export function nextHeldCourse(tab: Tab): Course | null {
  return heldByCourse(tab)[0]?.course ?? null
}

/** "Skicka varmrätt". */
export function fireLabel(course: Course): string {
  return `Skicka ${COURSE_LABEL[course].toLowerCase()}`
}

/**
 * True when the course before the next held one is ready on every station:
 * the moment to send the next course. False when nothing was sent before it.
 */
export function fireReady(tab: Tab): boolean {
  const next = nextHeldCourse(tab)
  if (!next) return false
  const before = courseProgress(tab).filter((c) => COURSE_ORDER.indexOf(c.course) < COURSE_ORDER.indexOf(next) && c.course !== 'drinks')
  return before.length > 0 && before.every((c) => c.state === 'ready')
}

export const LONG_OPEN_MIN = 90
export const STALE_OPEN_MIN = 12 * 60

/** "42 min", "1 h 12 min"; long after 90 min, stale ("Öppen sedan igår") after 12 h. */
export function elapsed(openedAt: string, now: number): { text: string; minutes: number; long: boolean; stale: boolean } {
  const at = Date.parse(openedAt)
  const minutes = Number.isNaN(at) ? 0 : Math.max(0, Math.floor((now - at) / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const text = h ? `${h} h ${m} min` : `${m} min`
  return { text, minutes, long: minutes >= LONG_OPEN_MIN, stale: minutes >= STALE_OPEN_MIN }
}

export interface EnterLine {
  key: string
  name: string
  quantity: number
  /** öre */
  amount: number
}

/** What to key into the POS: live items merged by name, options and unit price (sentOnly: only what reached the kitchen). */
export function toEnter(tab: Tab, { sentOnly = false } = {}): EnterLine[] {
  const lines = new Map<string, EnterLine>()
  for (const i of tab.items) {
    if (!live(i) || (sentOnly && i.state !== 'sent')) continue
    const opts = i.options.map((o) => o.choice).join(', ')
    const name = opts ? `${i.name} (${opts})` : i.name
    const key = `${name}|${i.unitPrice}`
    const line = lines.get(key) ?? { key, name, quantity: 0, amount: 0 }
    line.quantity += i.quantity
    line.amount += i.unitPrice * i.quantity
    lines.set(key, line)
  }
  return [...lines.values()]
}

/** Sum of covers and held portions over the open tabs (the stat tiles). */
export function boardTotals(tabs: Tab[]): { open: number; guests: number; held: number } {
  return {
    open: tabs.length,
    guests: tabs.reduce((s, t) => s + (t.covers ?? 0), 0),
    held: tabs.reduce((s, t) => s + heldByCourse(t).reduce((a, c) => a + c.quantity, 0), 0),
  }
}

export const REOPEN_MS = 15 * 60_000

/** Ångra stäng is possible for 15 minutes after close. */
export function canReopen(tab: Tab, now: number): boolean {
  const at = Date.parse(tab.closedAt ?? '')
  return tab.status === 'closed' && !Number.isNaN(at) && now - at < REOPEN_MS
}

/** "Bord 5" (or the custom name as it was when the tab was opened or moved). */
export function tabTitle(tab: Pick<Tab, 'tableLabel'>): string {
  return tableTitle(tab.tableLabel)
}

/** Rounds whose tickets never reached the stations ("Inte skickad", Skicka igen). */
export function undispatched(tab: Tab) {
  return tab.rounds.filter((r) => !r.dispatched)
}
