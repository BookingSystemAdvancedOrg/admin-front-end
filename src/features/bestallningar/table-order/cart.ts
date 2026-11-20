import type { Course, NewItem, TabMenu, TabMenuItem, TabOption } from './types'
import { COURSE_ORDER } from './courses'

/**
 * The waiter's cart while taking an order at the table. Nothing here is a
 * receipt: prices are only the reference total staff key into the
 * restaurant's own POS ("Att slå in"); the server prices every line again.
 */

/** Server limits (spec 6): lines per send and quantity per line. */
export const MAX_LINES = 30
export const MAX_QTY = 20
export const NOTE_MAX = 140

export interface CartLine {
  key: string
  menuItemId: string
  name: string
  /** öre, options included */
  unitPrice: number
  quantity: number
  options: TabOption[]
  note?: string
  allergy?: boolean
  course: Course
  stationId: string | null
  stationName: string | null
}

export interface LineExtra {
  options?: TabOption[]
  note?: string
  allergy?: boolean
  course?: Course
  quantity?: number
}

/** Same dish, options, note, allergy flag and course = the same line (taps add up). */
export function lineKey(menuItemId: string, extra: LineExtra, course: Course): string {
  const opts = (extra.options ?? []).map((o) => `${o.group}=${o.choice}`).sort().join('|')
  return [menuItemId, opts, (extra.note ?? '').trim(), extra.allergy ? 'a' : '', course].join('~')
}

/** Unit price in öre with the chosen options' extras. */
export function unitPriceOf(item: TabMenuItem, options: TabOption[] = []): number {
  let price = item.price
  for (const o of options) {
    const group = item.options.find((g) => g.name === o.group)
    const choice = group?.choices.find((c) => c.name === o.choice)
    if (choice) price += choice.price
  }
  return price
}

/** Does the dish need a choice before it can be added (a required option group)? */
export function needsOptions(item: TabMenuItem): boolean {
  return item.options.some((g) => g.required && g.choices.length > 0)
}

export function makeLine(item: TabMenuItem, extra: LineExtra = {}): CartLine {
  const course = extra.course ?? item.course
  const note = extra.note?.trim() ? extra.note.trim().slice(0, NOTE_MAX) : undefined
  const options = extra.options ?? []
  return {
    key: lineKey(item.menuItemId, { ...extra, note }, course),
    menuItemId: item.menuItemId,
    name: item.name,
    unitPrice: unitPriceOf(item, options),
    quantity: Math.min(MAX_QTY, Math.max(1, extra.quantity ?? 1)),
    options,
    ...(note ? { note } : {}),
    ...(extra.allergy ? { allergy: true } : {}),
    course,
    stationId: item.stationId,
    stationName: item.stationName,
  }
}

/** Adds a line, or adds its quantity to an identical one. */
export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const same = lines.find((l) => l.key === line.key)
  if (same) {
    return lines.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + line.quantity) } : l))
  }
  return [...lines, line]
}

/** New quantity for a line; 0 removes it. */
export function setQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.key !== key)
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))
}

/** Replaces a line after editing (options, note, course); merges into an identical line. */
export function replaceLine(lines: CartLine[], key: string, next: CartLine): CartLine[] {
  const rest = lines.filter((l) => l.key !== key)
  const at = lines.findIndex((l) => l.key === key)
  const same = rest.find((l) => l.key === next.key)
  if (same) return rest.map((l) => (l.key === next.key ? { ...l, quantity: Math.min(MAX_QTY, l.quantity + next.quantity) } : l))
  const out = [...rest]
  out.splice(at < 0 ? out.length : at, 0, next)
  return out
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0)
}

/** öre; the reference total, never a receipt */
export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0)
}

/** Quantity of one dish in the cart, all variants together (tile badge). */
export function dishCount(lines: CartLine[], menuItemId: string): number {
  return lines.filter((l) => l.menuItemId === menuItemId).reduce((n, l) => n + l.quantity, 0)
}

export function coursesIn(lines: CartLine[]): Course[] {
  return COURSE_ORDER.filter((c) => lines.some((l) => l.course === c))
}

/** The request body lines: one NewItem per cart line, `hold` from the course toggle. */
export function toNewItems(lines: CartLine[], hold: Record<Course, boolean>): NewItem[] {
  return lines.map((l) => ({
    menuItemId: l.menuItemId,
    quantity: l.quantity,
    ...(l.options.length ? { options: l.options } : {}),
    ...(l.note ? { note: l.note } : {}),
    ...(l.allergy ? { allergy: true } : {}),
    course: l.course,
    hold: hold[l.course],
  }))
}

export interface StationCount {
  stationId: string
  name: string
  quantity: number
  /** the station has no printer (its tickets print in the kitchen) */
  noPrinter: boolean
}

/**
 * "Skickas till: Kök 3 · Bar 2" and "Väntar: Varmrätt 2" for the send
 * preview. Lines without a station (no ticket) are left out.
 */
export function sendPreview(
  lines: CartLine[],
  hold: Record<Course, boolean>,
  menu: TabMenu | null,
): { now: StationCount[]; waiting: { course: Course; quantity: number }[] } {
  const now = new Map<string, StationCount>()
  const waiting = new Map<Course, number>()
  for (const l of lines) {
    if (hold[l.course]) {
      waiting.set(l.course, (waiting.get(l.course) ?? 0) + l.quantity)
      continue
    }
    if (!l.stationId) continue
    const station = menu?.stations.find((s) => s.stationId === l.stationId)
    const hit = now.get(l.stationId)
    if (hit) hit.quantity += l.quantity
    else {
      now.set(l.stationId, {
        stationId: l.stationId,
        name: station?.name ?? l.stationName ?? l.stationId,
        quantity: l.quantity,
        noPrinter: station ? station.printers === 0 : false,
      })
    }
  }
  return {
    now: [...now.values()],
    waiting: COURSE_ORDER.filter((c) => waiting.has(c)).map((c) => ({ course: c, quantity: waiting.get(c)! })),
  }
}

/**
 * The cart against the menu as it is now (Meny changed a price, a dish sold
 * out or was deleted): names, prices and stations follow the menu, dishes no
 * longer on it are left out and named in `dropped`. `changed` is false when
 * nothing differs, so callers can skip a render.
 */
export function reconcile(lines: CartLine[], menu: TabMenu): { lines: CartLine[]; dropped: string[]; changed: boolean } {
  const byId = new Map(menu.items.map((i) => [i.menuItemId, i]))
  const dropped: string[] = []
  let changed = false
  const out: CartLine[] = []
  for (const l of lines) {
    const item = byId.get(l.menuItemId)
    if (!item) {
      dropped.push(l.name)
      changed = true
      continue
    }
    const unitPrice = unitPriceOf(item, l.options)
    if (unitPrice !== l.unitPrice || item.name !== l.name || item.stationId !== l.stationId || item.stationName !== l.stationName) {
      changed = true
      out.push({ ...l, name: item.name, unitPrice, stationId: item.stationId, stationName: item.stationName })
    } else out.push(l)
  }
  return { lines: changed ? out : lines, dropped, changed }
}
