import type { TableInfo } from '../../shared/tables'
import type { BusinessHoursInterval, SpecialDay, SpecialDayKind, TableRule } from './locationApi'

/**
 * Regler för bord vid onlinebokning och avvikande öppettider - samma regler
 * som backendens shared/booking_rules.py (servern kontrollerar dem igen).
 */

export const MAX_PARTY = 50
export const MIN_COMBINATION = 2
export const MAX_COMBINATION = 6

export function defaultMin(seats: number): number {
  return Math.max(1, Math.ceil(seats / 2))
}

export interface RowState {
  online: boolean
  min: string
  max: string
}

export interface ComboDraft {
  tableIds: string[]
  min: string
  max: string
}

export function whole(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null
}

export function rowsFor(tables: TableInfo[], rules: Record<string, TableRule>): Record<string, RowState> {
  const rows: Record<string, RowState> = {}
  for (const t of tables) {
    const rule = rules[t.tableId]
    rows[t.tableId] = rule
      ? { online: rule.online, min: String(rule.minParty), max: String(Math.min(rule.maxParty, t.seats)) }
      : { online: true, min: String(defaultMin(t.seats)), max: String(t.seats) }
  }
  return rows
}

/** Reglerna att spara: bara bord vars inställning skiljer sig från standard. */
export function rulesToSave(
  tables: TableInfo[],
  rows: Record<string, RowState>,
): { rules: Record<string, TableRule>; error: string | null } {
  const rules: Record<string, TableRule> = {}
  for (const t of tables) {
    const row = rows[t.tableId]
    if (!row) continue
    const min = whole(row.min)
    const max = whole(row.max)
    const name = `Bord ${t.label}`
    if (min === null || max === null || min < 1 || max < 1 || min > MAX_PARTY || max > MAX_PARTY) {
      return { rules, error: `${name}: ange antal personer som heltal 1-${MAX_PARTY}.` }
    }
    if (min > max) return { rules, error: `${name}: minst kan inte vara fler än högst.` }
    if (max > t.seats) return { rules, error: `${name}: högst ${t.seats} personer (bordets platser).` }
    if (row.online && min === defaultMin(t.seats) && max === t.seats) continue
    rules[t.tableId] = { minParty: min, maxParty: max, online: row.online }
  }
  return { rules, error: null }
}


export const KIND_LABEL: Record<SpecialDayKind, string> = {
  closed: 'Stängt',
  hours: 'Andra öppettider',
  no_online: 'Ingen onlinebokning',
}
export const NOTE_MAX = 80
export const DAYS_AHEAD = 730
/** Bokningar finns bara inom bokningshorisonten (21 dagar). */
export const BOOKING_HORIZON_DAYS = 21
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export interface Draft {
  date: string
  kind: SpecialDayKind
  intervals: BusinessHoursInterval[]
  note: string
}

export function emptyDraft(): Draft {
  return { date: '', kind: 'closed', intervals: [{ opensAt: '17:00', closesAt: '22:00' }], note: '' }
}

export function intervalsError(intervals: BusinessHoursInterval[]): string | null {
  if (intervals.length === 0) return 'Ange minst en öppettid.'
  for (const { opensAt, closesAt } of intervals) {
    if (!TIME.test(opensAt) || !TIME.test(closesAt)) return 'Ange tiderna som TT:MM.'
    if (opensAt >= closesAt) return 'Öppningstiden måste vara före stängningstiden.'
  }
  const sorted = [...intervals].sort((a, b) => a.opensAt.localeCompare(b.opensAt))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].closesAt > sorted[i].opensAt) return 'Tiderna får inte överlappa varandra.'
  }
  return null
}

export function describe(day: SpecialDay): string {
  if (day.kind === 'hours') {
    return `${KIND_LABEL.hours} ${(day.intervals ?? []).map((i) => `${i.opensAt}-${i.closesAt}`).join(', ')}`
  }
  return KIND_LABEL[day.kind]
}

export function sortDays(days: SpecialDay[]): SpecialDay[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date))
}

