import type { LayoutVersionList, PublishedLayoutSnapshot } from './layoutApi'

/**
 * Versionerna i den ordning de gäller: den som gäller nu, sedan de som tar
 * över (tidigast först), sist de som inte är inplanerade (nyast först).
 */
export type TimelineKind = 'current' | 'next' | 'unscheduled'

export interface TimelineEntry {
  snapshot: PublishedLayoutSnapshot
  kind: TimelineKind
  /** När versionen tar över (bara 'next'). */
  from: string | null
  /** När en tidigare gällande version slutade gälla. */
  endedAt: string | null
  tables: number
  seats: number
  floors: number
}

export function countsOf(snapshot: PublishedLayoutSnapshot) {
  let tables = 0
  let seats = 0
  let floors = 0
  for (const el of snapshot.elements ?? []) {
    if (el.type === 'table') {
      tables += 1
      seats += el.seats ?? 2
    } else if (el.type === 'floor') floors += 1
  }
  return { tables, seats, floors: Math.max(1, floors) }
}

export function versionTimeline(
  versions: PublishedLayoutSnapshot[],
  now: Date = new Date(),
): TimelineEntry[] {
  const t = now.getTime()
  const entry = (snapshot: PublishedLayoutSnapshot, kind: TimelineKind): TimelineEntry => {
    const ended = !snapshot.isCurrent && snapshot.effectiveTo && Date.parse(snapshot.effectiveTo) <= t
    return {
      snapshot,
      kind,
      from: kind === 'next' ? snapshot.effectiveFrom : null,
      endedAt: ended ? snapshot.effectiveTo : null,
      ...countsOf(snapshot),
    }
  }
  const isNext = (v: PublishedLayoutSnapshot) =>
    !v.isCurrent && v.effectiveFrom !== null && Date.parse(v.effectiveFrom) > t

  const current = versions.filter((v) => v.isCurrent).map((v) => entry(v, 'current'))
  const next = versions
    .filter(isNext)
    .sort((a, b) => Date.parse(a.effectiveFrom!) - Date.parse(b.effectiveFrom!))
    .map((v) => entry(v, 'next'))
  const rest = versions
    .filter((v) => !v.isCurrent && !isNext(v))
    .sort((a, b) => b.version - a.version)
    .map((v) => entry(v, 'unscheduled'))
  return [...current, ...next, ...rest]
}

/** "4 bord, 12 platser" (och våningar när de är fler än en). */
export function sizeText(e: Pick<TimelineEntry, 'tables' | 'seats' | 'floors'>): string {
  const parts = [
    `${e.tables} bord`,
    `${e.seats} ${e.seats === 1 ? 'plats' : 'platser'}`,
  ]
  if (e.floors > 1) parts.push(`${e.floors} våningar`)
  return parts.join(', ')
}

/** "17 dec." i år, "17 dec. 2027" annars (svensk tid). */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  const zone = 'Europe/Stockholm'
  const year = (x: Date) => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', timeZone: zone }).format(x)
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    ...(year(d) === year(now) ? {} : { year: 'numeric' }),
    timeZone: zone,
  }).format(d)
}

/** "17 december" i år, "17 december 2027" annars (svensk tid). */
export function longDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  const zone = 'Europe/Stockholm'
  const year = (x: Date) => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', timeZone: zone }).format(x)
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    ...(year(d) === year(now) ? {} : { year: 'numeric' }),
    timeZone: zone,
  }).format(d)
}

/** Lokalt datum (ÅÅÅÅ-MM-DD) för ett ögonblick, i svensk tid. */
export function localDate(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(d)
}

/** Dagar från idag till ett lokalt datum (ÅÅÅÅ-MM-DD), i svensk tid. */
export function daysUntil(date: string, now: Date = new Date()): number {
  const today = Date.parse(`${localDate(now.toISOString())}T00:00:00Z`)
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000)
}

/** Tidigaste dag ett byte får ske: ur API:t, annars idag + bokningsfönster + 1. */
export function earliestDate(
  list: Pick<LayoutVersionList, 'earliestChangeDate' | 'bookingHorizonDays'>,
  now: Date = new Date(),
): string {
  if (list.earliestChangeDate) return list.earliestChangeDate
  const today = Date.parse(`${localDate(now.toISOString())}T00:00:00Z`)
  return new Date(today + (list.bookingHorizonDays + 1) * 86_400_000).toISOString().slice(0, 10)
}
