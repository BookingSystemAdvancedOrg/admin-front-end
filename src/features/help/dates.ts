/**
 * Dagar och perioder i frågor till assistenten ("Hur många bokningar har vi
 * imorgon?"). Samma regler som servern (application/shared/help_dates.py),
 * testade med samma exempel: imorgon, i övermorgon, igår, i förrgår, en
 * veckodag ("på fredag", "nästa fredag", "i fredags"), i helgen, förra och
 * nästa helg, nästa och förra vecka och datum ("20 november", "den 20:e nov
 * 2026", "20/11", "2026-11-20"). Dagarna räknas i Europe/Stockholm.
 *
 * Svaret: from och to (åååå-mm-dd), label ("imorgon, lördag 15 november")
 * och query, frågan med dagen utbytt mot "idag" så att sökningen hittar
 * dagens levande siffror.
 */

export type When = { from: string; to: string; label: string; query: string }

export const TZ = 'Europe/Stockholm'

/** Dagens datum (åååå-mm-dd) i Europe/Stockholm. */
export function todayIn(tz = TZ, now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Samma vikning som retrieve.ts (och servern). */
function fold(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const WEEKDAYS = ['mandag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lordag', 'sondag']
const WEEKDAY_NAMES = ['måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag']
const MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december']
const MONTHS: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, mars: 3, mar: 3, april: 4, apr: 4, maj: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, augusti: 8, aug: 8, september: 9, sept: 9, sep: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, december: 12, dec: 12,
}
const MONTH = Object.keys(MONTHS).sort((a, b) => b.length - a.length || a.localeCompare(b)).join('|')
const WD = WEEKDAYS.join('|')

/** Ett datum utan klockslag (UTC internt, så att sommartid inte flyttar dagar). */
type Day = Date

const day = (y: number, m: number, d: number): Day | null => {
  const out = new Date(Date.UTC(y, m - 1, d))
  return out.getUTCFullYear() === y && out.getUTCMonth() === m - 1 && out.getUTCDate() === d ? out : null
}
const parse = (iso: string): Day => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
const iso = (d: Day) => d.toISOString().slice(0, 10)
const plus = (d: Day, days: number) => new Date(d.getTime() + days * 86_400_000)
const between = (a: Day, b: Day) => Math.round((a.getTime() - b.getTime()) / 86_400_000)
/** 0 = måndag, som Pythons weekday(). */
const weekday = (d: Day) => (d.getUTCDay() + 6) % 7

export function dayLabel(d: Day, today: Day): string {
  const out = `${WEEKDAY_NAMES[weekday(d)]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`
  return d.getUTCFullYear() === today.getUTCFullYear() ? out : `${out} ${d.getUTCFullYear()}`
}

export function rangeLabel(a: Day, b: Day, today: Day): string {
  const end = dayLabel(b, today).split(' ').slice(1).join(' ')
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${dayLabel(a, today).split(' ').slice(1).join(' ')} ${a.getUTCFullYear()} till ${end}`
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${a.getUTCDate()} ${MONTH_NAMES[a.getUTCMonth()]} till ${end}`
  return `${a.getUTCDate()} till ${end}`
}

/** Datumet utan år: det som ligger närmast idag (ett framtida vid lika avstånd). */
function nearest(month: number, d: number, today: Day): Day | null {
  const y = today.getUTCFullYear()
  const options = [0, 1, -1].map((k) => day(y + k, month, d)).filter((x): x is Day => x !== null)
  if (!options.length) return null
  const key = (x: Day) => [Math.abs(between(x, today)), x < today ? 1 : 0]
  return options.reduce((best, x) => {
    const [a1, a2] = key(x)
    const [b1, b2] = key(best)
    return a1 < b1 || (a1 === b1 && a2 < b2) ? x : best
  })
}

/** Helgen som pågår eller kommer, flyttad hela veckor. */
function weekend(today: Day, shiftWeeks = 0): [Day, Day] {
  const wd = weekday(today)
  const saturday = plus(wd >= 5 ? plus(today, -(wd - 5)) : plus(today, 5 - wd), shiftWeeks * 7)
  return [saturday, plus(saturday, 1)]
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const swap = (q: string, m: RegExpExecArray) => squash(`${q.slice(0, m.index)} idag ${q.slice(m.index + m[0].length)}`)
const result = (a: Day, b: Day, label: string, query: string): When => ({ from: iso(a), to: iso(b), label, query })
function onDay(d: Day, today: Day, word: string | null, query: string): When {
  const name = dayLabel(d, today)
  const w = d.getTime() === today.getTime() ? 'idag' : word
  return result(d, d, w ? `${w}, ${name}` : name, query)
}

/** En dag eller period som inte är idag i frågan, eller null. today: åååå-mm-dd. */
export function parseWhen(question: string, todayIso: string): When | null {
  const today = parse(todayIso)
  const raw = (question ?? '').toLowerCase()
  const q = ` ${fold(question)} `
  let m: RegExpExecArray | null

  // Datum: 2026-11-20, 20/11(/2026), 20 november (2026), den 20:e nov.
  m = / (\d{4}) (\d{1,2}) (\d{1,2}) /.exec(q)
  if (m && /\d{4}-\d{1,2}-\d{1,2}/.test(raw)) {
    const d = day(Number(m[1]), Number(m[2]), Number(m[3]))
    return d ? onDay(d, today, null, swap(q, m)) : null
  }
  const s = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?![\d/])/.exec(raw)
  if (s) {
    const d = s[3] ? day(Number(s[3]), Number(s[2]), Number(s[1])) : nearest(Number(s[2]), Number(s[1]), today)
    return d ? onDay(d, today, null, fold(`${raw.slice(0, s.index)} idag ${raw.slice(s.index + s[0].length)}`)) : null
  }
  m = new RegExp(` (?:den )?(\\d{1,2})(?: e| a)? (${MONTH})(?: (\\d{4}))?(?= )`).exec(q)
  if (m) {
    const month = MONTHS[m[2]]
    const d = m[3] ? day(Number(m[3]), month, Number(m[1])) : nearest(month, Number(m[1]), today)
    return d ? onDay(d, today, null, swap(q, m)) : null
  }

  // Dagarna intill idag.
  const near: [RegExp, number, string][] = [
    [/ i ?overmorgon /, 2, 'i övermorgon'], [/ overmorgon /, 2, 'i övermorgon'],
    [/ i ?morgon /, 1, 'imorgon'], [/ i ?morn /, 1, 'imorgon'],
    [/ i ?forrgar /, -2, 'i förrgår'], [/ forrgar /, -2, 'i förrgår'],
    [/ i ?gar /, -1, 'igår'],
  ]
  for (const [pattern, offset, word] of near) {
    m = pattern.exec(q)
    if (m) return onDay(plus(today, offset), today, word, swap(q, m))
  }

  // Veckor och helger.
  const monday = plus(today, -weekday(today))
  m = / (nasta|kommande) vecka(n)? /.exec(q)
  if (m) {
    const a = plus(monday, 7)
    const b = plus(a, 6)
    return result(a, b, `nästa vecka, ${rangeLabel(a, b, today)}`, swap(q, m))
  }
  m = / (forra|forriga) vecka(n)? /.exec(q)
  if (m) {
    const a = plus(monday, -7)
    const b = plus(a, 6)
    return result(a, b, `förra veckan, ${rangeLabel(a, b, today)}`, swap(q, m))
  }
  m = / (?:i |till |over |under )?(?:(forra|forriga|nasta|kommande) )?helg(en)? /.exec(q)
  if (m) {
    const which = m[1]
    let sat: Day, sun: Day, word: string
    if (which === 'forra' || which === 'forriga') {
      ;[sat, sun] = weekend(today, -1)
      word = 'förra helgen'
    } else if (which) {
      ;[sat, sun] = weekend(today, weekday(today) >= 5 ? 1 : 0)
      word = 'nästa helg'
    } else {
      ;[sat, sun] = weekend(today)
      word = 'i helgen'
    }
    return result(sat, sun, `${word}, ${rangeLabel(sat, sun, today)}`, swap(q, m))
  }

  // Veckodagar: i fredags, förra fredagen (förbi); nästa fredag (efter idag); på fredag (idag eller senare).
  m = new RegExp(` i (${WD})s `).exec(q) ?? new RegExp(` (?:forra|forriga) (${WD})(?:en)? `).exec(q)
  if (m) {
    const back = (weekday(today) - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7
    return onDay(plus(today, -back), today, null, swap(q, m))
  }
  m = new RegExp(` (?:nasta|kommande) (${WD})(?:en)? `).exec(q)
  if (m) {
    const ahead = (WEEKDAYS.indexOf(m[1]) - weekday(today) + 7) % 7 || 7
    return onDay(plus(today, ahead), today, null, swap(q, m))
  }
  m = new RegExp(` (?:pa )?(${WD})(?:en)? `).exec(q)
  if (m) {
    const ahead = (WEEKDAYS.indexOf(m[1]) - weekday(today) + 7) % 7
    return onDay(plus(today, ahead), today, null, swap(q, m))
  }
  return null
}
