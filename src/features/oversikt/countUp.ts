/**
 * Räknar upp ett nyckeltal från 0 till slutvärdet medan rutan fylls.
 *
 * Värdet är redan formaterat ("4", "1 250 kr", "12,50 kr", "-"). Vi plockar
 * ut talet, räknar upp det och sätter tillbaka samma prefix/suffix, så att
 * den sista bildrutan är exakt den sträng sidan annars hade visat.
 */
export interface StatNumber {
  prefix: string
  value: number
  decimals: number
  suffix: string
}

export function parseStatValue(text: string): StatNumber | null {
  const m = /^(\D*?)(\d[\d\s\u00a0]*?)(?:,(\d+))?(\D*)$/.exec(text)
  if (!m) return null
  const whole = m[2].replace(/[\s\u00a0]/g, '')
  const frac = m[3] ?? ''
  const value = Number(`${whole}.${frac || '0'}`)
  if (!Number.isFinite(value)) return null
  return { prefix: m[1], value, decimals: frac.length, suffix: m[4] }
}

export function formatStatValue(n: StatNumber, current: number): string {
  const fixed = current.toFixed(n.decimals)
  const [whole, frac] = fixed.split('.')
  // Tusentalsavgränsning med mellanslag, som kronor() gör.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const body = n.decimals > 0 ? `${grouped},${frac}` : grouped
  return `${n.prefix}${body}${n.suffix}`
}

/** Mjuk inbromsning: snabbt i början, landar lugnt på slutvärdet. */
export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return 1 - (1 - u) ** 3
}
