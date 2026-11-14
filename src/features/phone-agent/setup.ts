import type { BusinessHours } from '../installningar/locationApi'
import type { Config, Day, LocationConfig, Mode, Span } from './api'

/** Telefonassistentens kom igång: fem steg, en fråga per skärm. Rena hjälpfunktioner (testade i setup.test.ts). */

export type Step = 'namn' | 'tider' | 'nummer' | 'koppla' | 'prova'
export const STEPS: Step[] = ['namn', 'tider', 'nummer', 'koppla', 'prova']

export type Progress = Record<Step, boolean>

/** Vilka steg som är klara, delas av checklistan och guiden. */
export function progress(config: Pick<Config, 'version'>, loc: Pick<LocationConfig, 'version' | 'enabled' | 'number' | 'setup'>): Progress {
  return {
    namn: config.version > 0,
    tider: loc.version > 0,
    nummer: Boolean(loc.enabled && loc.number),
    koppla: Boolean(loc.setup?.forwardedAt),
    prova: Boolean(loc.setup?.testedAt),
  }
}

/** Första steget som inte är klart, eller null när allt är klart. */
export function firstOpen(p: Progress): Step | null {
  return STEPS.find((s) => !p[s]) ?? null
}

/**
 * En `tel:`-länk för en vidarekopplingskod. `#` måste vara %23 i länken
 * (annars blir resten ett ankare); `*` och `+` får stå kvar. iPhone ringer
 * inte koder från länkar alls, därför visas koden alltid också som text.
 */
export function encodeTel(code: string): string {
  return `tel:${code.replace(/#/g, '%23')}`
}

const AGENT_DAYS: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const BH_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
const SHORT = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön']
const DAY = 1440
const WEEK = 7 * DAY
const END = '23:59'

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const toHHMM = (min: number) => {
  const m = ((min % DAY) + DAY) % DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Har platsen några öppettider alls? */
export function hasBusinessHours(bh: BusinessHours | null | undefined): bh is BusinessHours {
  return Boolean(bh && BH_DAYS.some((d) => (bh[d] ?? []).some((i) => i.opensAt && i.closesAt)))
}

/** Öppet per dag i minuter [från, till) inom dygnet; ett pass över midnatt fortsätter nästa morgon. */
function openPerDay(bh: BusinessHours): [number, number][][] {
  const days: [number, number][][] = AGENT_DAYS.map(() => [])
  BH_DAYS.forEach((d, i) => {
    for (const { opensAt, closesAt } of bh[d] ?? []) {
      if (!/^\d\d:\d\d$/.test(opensAt ?? '') || !/^\d\d:\d\d$/.test(closesAt ?? '')) continue
      const open = toMin(opensAt)
      const close = toMin(closesAt)
      if (close > open) {
        days[i].push([open, close])
      } else {
        days[i].push([open, DAY])
        if (close > 0) days[(i + 1) % 7].push([0, close])
      }
    }
  })
  return days.map((spans) => merge(spans.sort((a, b) => a[0] - b[0])))
}

function merge(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const [a, b] of spans) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

function toSpans(spans: [number, number][]): Span[] {
  // Servern tar högst tre perioder per dag: behåll de tre längsta.
  const kept = spans.filter(([a, b]) => b > a).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 3)
  return kept.sort((x, y) => x[0] - y[0]).map(([a, b]) => ({ from: toHHMM(a), to: b >= DAY ? END : toHHMM(b) }))
}

/**
 * Assistentens tider för ett läge, räknat från öppettiderna:
 * `after_hours` = när det är stängt (00:00 till öppning, stängning till 23:59),
 * `overflow` = öppettiderna, `always` = inga tider (svarar dygnet runt).
 */
export function hoursFor(mode: Mode, bh: BusinessHours | null | undefined): Partial<Record<Day, Span[]>> {
  if (mode === 'always' || !hasBusinessHours(bh)) return {}
  const open = openPerDay(bh)
  const out: Partial<Record<Day, Span[]>> = {}
  AGENT_DAYS.forEach((day, i) => {
    if (mode === 'overflow') {
      out[day] = toSpans(open[i])
      return
    }
    const gaps: [number, number][] = []
    let at = 0
    for (const [a, b] of open[i]) {
      if (a > at) gaps.push([at, a])
      at = Math.max(at, b)
    }
    if (at < DAY) gaps.push([at, DAY])
    out[day] = toSpans(gaps)
  })
  return out
}

/** Veckans tider som sammanhängande intervall i minuter från måndag 00:00 (över midnatt i ett stycke). */
function weekRanges(hours: Partial<Record<Day, Span[]>>): [number, number][] {
  const raw: [number, number][] = []
  AGENT_DAYS.forEach((day, i) => {
    for (const s of hours[day] ?? []) {
      const end = s.to === END ? DAY : toMin(s.to)
      raw.push([i * DAY + toMin(s.from), i * DAY + end])
    }
  })
  const ranges = merge(raw.sort((a, b) => a[0] - b[0]))
  // Söndag kväll som fortsätter in i måndag morgon är ett intervall.
  if (ranges.length > 1 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === WEEK) {
    const first = ranges.shift()!
    ranges[ranges.length - 1][1] = WEEK + first[1]
  }
  return ranges
}

/**
 * En rad om tiderna: "Mån-tor 22:00-11:00, fre 22:00-mån 11:00",
 * "Lör-sön hela dagen". Tomt när det inte finns några tider.
 */
export function hoursSummary(hours: Partial<Record<Day, Span[]>>): string {
  const ranges = weekRanges(hours)
  if (!ranges.length) return ''
  if (ranges.length === 1 && ranges[0][1] - ranges[0][0] >= WEEK) return 'Hela veckan'
  type Part = { day: number; key: string; text: (days: string) => string }
  const parts: Part[] = ranges.map(([s, e]) => {
    const day = Math.floor(s / DAY)
    const endDay = Math.floor((e - 1) / DAY)
    if (s % DAY === 0 && e % DAY === 0) {
      const n = (e - s) / DAY
      return n === 1
        ? { day, key: 'whole1', text: (d) => `${d} hela dagen` }
        : { day, key: `whole${n}-${day}`, text: () => `${SHORT[day % 7]}-${SHORT[(day + n - 1) % 7]} hela dagen` }
    }
    const from = toHHMM(s)
    const to = toHHMM(e)
    if (endDay - day <= 1) return { day, key: `${from}-${to}`, text: (d) => `${d} ${from}-${to}` }
    return { day, key: `${s}-${e}`, text: () => `${SHORT[day % 7]} ${from}-${SHORT[endDay % 7]} ${to}` }
  })
  // Samma tider på dagar i följd: "mån-tor 22:00-11:00".
  const out: string[] = []
  for (let i = 0; i < parts.length;) {
    let j = i
    while (j + 1 < parts.length && parts[j + 1].key === parts[i].key && parts[j + 1].day === parts[j].day + 1) j++
    const days = j > i ? `${SHORT[parts[i].day % 7]}-${SHORT[parts[j].day % 7]}` : SHORT[parts[i].day % 7]
    out.push(parts[i].text(days))
    i = j + 1
  }
  const text = out.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Svarar assistenten vid `at` enligt tiderna (Stockholmstid)? */
export function insideHours(hours: Partial<Record<Day, Span[]>>, at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')))
  const clock = `${get('hour')}:${get('minute')}`
  return (hours[AGENT_DAYS[day]] ?? []).some((s) => s.from <= clock && clock < s.to)
}
