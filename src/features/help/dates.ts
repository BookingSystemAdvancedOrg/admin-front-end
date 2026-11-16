/**
 * Dagar och perioder i frågor till assistenten ("Hur många bokningar har vi
 * imorgon?"). Samma regler som servern (application/shared/help_dates.py),
 * testade med samma exempel: imorgon, i övermorgon, igår, i förrgår, en
 * veckodag ("på fredag", "nästa fredag", "i fredags"), i helgen, förra och
 * nästa helg, nästa och förra vecka och datum ("20 november", "den 20:e nov
 * 2026", "20/11", "2026-11-20"), datum från och till ("5 sep till 10 sep",
 * "mellan 1 och 7 nov") och från en dag fram till idag ("sedan måndag",
 * "sedan 1 november"). Två dagar som inte är en period ("1/2 imorgon") ger
 * null, så att ingen fel dag gissas. Dagarna räknas i Europe/Stockholm.
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

export const MAX_DAYS = 31
const ISO = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g
const SLASH = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?![\d/])/g
const DATE = `(?:den )?(\\d{1,2})(?: e| a)? (${MONTH})(?: (\\d{4}))?`
/** "5 sep till 10 sep", "5 till 10 sep", "från 1/11 till 7/11", "mellan 1 och 7 nov". */
const RANGE = [
  new RegExp(` (?:fran (?:och med )?)?(?:den )?(\\d{1,2})(?: e| a)?(?: (${MONTH}))?(?: (\\d{4}))? (?:till(?: och med)?|t o m|tom) ${DATE}(?= )`),
  new RegExp(` mellan (?:den )?(\\d{1,2})(?: e| a)?(?: (${MONTH}))?(?: (\\d{4}))? och ${DATE}(?= )`),
]

/** Datum med siffror utskrivna ("20/11" blir "20 november"), så att ett mönster läser alla; null för en månad som inte finns. */
function spelled(raw: string): string | null {
  let bad = false
  const spell = (d: string, m: string, y: string | undefined) => {
    if (Number(m) < 1 || Number(m) > 12) {
      bad = true
      return ' '
    }
    return ` ${Number(d)} ${MONTH_NAMES[Number(m) - 1]}${y ? ` ${y}` : ''} `
  }
  const out = raw.replace(ISO, (_, y: string, m: string, d: string) => spell(d, m, y)).replace(SLASH, (_, d: string, m: string, y?: string) => spell(d, m, y))
  return bad ? null : out
}

function span(a: Day, b: Day, today: Day, query: string): When | null {
  if (b < a || between(b, a) + 1 > MAX_DAYS) return null
  if (a.getTime() === b.getTime()) return onDay(a, today, null, query)
  return result(a, b, rangeLabel(a, b, today), query)
}

function since(a: Day, today: Day, query: string): When | null {
  if (a.getTime() === today.getTime()) return onDay(a, today, null, query)
  if (between(today, a) + 1 > MAX_DAYS) return null
  return result(a, today, `sedan ${dayLabel(a, today)}`, query)
}

/** En dag eller period som inte är idag i frågan, eller null. today: åååå-mm-dd. */
export function parseWhen(question: string, todayIso: string): When | null {
  const found = parse1(question, todayIso)
  // Två dagar som inte är en period ("1/2 imorgon"): ingen gissning.
  return found && parse1(found.query, todayIso) ? null : found
}

/** Nämner frågan en dag eller period alls (också två, som parseWhen inte gissar mellan)? */
export function namesDay(question: string, todayIso: string): boolean {
  return parse1(question, todayIso) !== null
}

function parse1(question: string, todayIso: string): When | null {
  const today = parse(todayIso)
  const raw = spelled((question ?? '').toLowerCase())
  if (raw === null) return null
  const q = ` ${fold(raw)} `
  let m: RegExpExecArray | null

  // Datum från och till: slutet har månaden, början kan sakna den.
  for (const pattern of RANGE) {
    m = pattern.exec(q)
    if (!m) continue
    const [, d1, m1, y1, d2, m2, y2] = m
    const first = MONTHS[m1 ?? m2]
    const last = MONTHS[m2]
    let a: Day | null
    let b: Day | null
    if (y1 || y2) {
      a = day(Number(y1 ?? y2), first, Number(d1))
      b = day(Number(y2 ?? y1), last, Number(d2))
      // "30 dec till 2 jan 2027": året som inte står flyttas.
      if (a && b && a > b) {
        if (!y2) b = day(a.getUTCFullYear() + 1, last, Number(d2))
        else a = day(b.getUTCFullYear() - 1, first, Number(d1))
      }
    } else {
      a = nearest(first, Number(d1), today)
      b = a ? day(a.getUTCFullYear(), last, Number(d2)) : null
      if (a && b && b < a) b = day(a.getUTCFullYear() + 1, last, Number(d2))
    }
    return a && b ? span(a, b, today, swap(q, m)) : null
  }

  // "sedan måndag", "sedan 1 november", "sedan igår": från den dagen fram till idag.
  m = new RegExp(` sedan (?:i )?(?:(?:forra|forriga) )?(${WD})(?:en|s)? `).exec(q)
  if (m) return since(plus(today, -((weekday(today) - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7)), today, swap(q, m))
  m = new RegExp(` sedan ${DATE}(?= )`).exec(q)
  if (m) {
    const month = MONTHS[m[2]]
    let a = day(m[3] ? Number(m[3]) : today.getUTCFullYear(), month, Number(m[1]))
    if (a && a > today && !m[3]) a = day(today.getUTCFullYear() - 1, month, Number(m[1]))
    return a && a <= today ? since(a, today, swap(q, m)) : null
  }
  m = / sedan (i ?gar|i ?forrgar) /.exec(q)
  if (m) return since(plus(today, m[1].includes('forrgar') ? -2 : -1), today, swap(q, m))

  // Datum: 2026-11-20, 20/11(/2026), 20 november (2026), den 20:e nov.
  m = new RegExp(` ${DATE}(?= )`).exec(q)
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
