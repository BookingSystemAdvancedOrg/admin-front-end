/**
 * Gemensamma hjälpare för Statistik och Översiktens månadskort: datum,
 * jämförelser och svensk formatering. Belopp är i öre, som i resten av appen.
 */

const pad = (n: number) => String(n).padStart(2, '0')

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1
}

/** Alla dagar från och med `from` till och med `to`. */
export function datesIn(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Måndag = 0. */
export function weekdayOf(iso: string): number {
  return (parseDay(iso).getDay() + 6) % 7
}

/* --- Jämförelser och text ------------------------------------------------ */

/** Förändring i procent mot förra perioden; null när det inte går att jämföra. */
export function deltaPct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

/** "Omsättningen upp 12 %"-rubrik; bara basen när det inte går att jämföra. */
export function insightTitle(base: string, pct: number | null, words: { up?: string; down?: string } = {}): string {
  if (pct === null || !Number.isFinite(pct)) return base
  if (Math.abs(pct) < 0.5) return `${base} oförändrad`
  return `${base} ${pct > 0 ? (words.up ?? 'upp') : (words.down ?? 'ned')} ${fmtPct(Math.abs(pct))}`
}

export function fmtKr(ore: number | null | undefined): string {
  if (ore == null || !Number.isFinite(ore)) return '-'
  return `${Math.round(ore / 100).toLocaleString('sv-SE')} kr`
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return Math.round(n).toLocaleString('sv-SE')
}

export function fmtDecimal(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString('sv-SE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  const digits = Math.abs(n) < 10 && Math.abs(n) !== 0 ? 1 : 0
  return `${n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: digits })}\u00a0%`
}

/** "21 okt" */
export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(parseDay(iso)).replace('.', '')
}

/** "21 okt till 19 nov" */
export function rangeLabel(from: string, to: string): string {
  return `${shortDate(from)} till ${shortDate(to)}`
}
