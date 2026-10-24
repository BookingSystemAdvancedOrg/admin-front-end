/**
 * Hur det går: en gemensam regel för om ett nyckeltal är grönt (bättre än
 * jämförelsen), rött (sämre) eller neutralt. Neutralt är det när det inte
 * finns något att jämföra med, när talet står på noll (dagen eller perioden
 * har just börjat) eller när förändringen är så liten att den är brus.
 *
 * Varje mått vet åt vilket håll det är bra: mer omsättning är bra, färre
 * uteblivna är bra. Färgen står aldrig ensam: texten ("+12 %") och
 * skärmläsartexten ("upp 12 % mot förra veckan") säger samma sak.
 */

export type TrendTone = 'good' | 'bad' | 'neutral'

export type TrendMetric =
  | 'revenue'
  | 'avgOrder'
  | 'orders'
  | 'bookings'
  | 'guests'
  | 'occupancy'
  | 'visits'
  | 'dishQuantity'
  | 'noShows'
  | 'cancellations'
  | 'prepTime'
  | 'unprinted'
  | 'failedPayments'

interface MetricRule {
  /** Åt vilket håll talet ska gå för att det ska vara bra. */
  better: 'up' | 'down'
  /** Minsta förändring i procent som räknas (mindre är brus). */
  minPct: number
  /** Minsta förändring i måttets enhet (kronor i öre, antal, procentenheter, minuter). */
  minAbs: number
  /** Visa förändringen i procent eller som skillnad ("-3"). */
  show: 'pct' | 'abs'
}

const RULES: Record<TrendMetric, MetricRule> = {
  revenue: { better: 'up', minPct: 2, minAbs: 100_00, show: 'pct' },
  avgOrder: { better: 'up', minPct: 2, minAbs: 5_00, show: 'pct' },
  orders: { better: 'up', minPct: 2, minAbs: 1, show: 'pct' },
  bookings: { better: 'up', minPct: 2, minAbs: 1, show: 'pct' },
  guests: { better: 'up', minPct: 2, minAbs: 1, show: 'pct' },
  occupancy: { better: 'up', minPct: 2, minAbs: 1, show: 'pct' },
  visits: { better: 'up', minPct: 2, minAbs: 5, show: 'pct' },
  dishQuantity: { better: 'up', minPct: 5, minAbs: 2, show: 'pct' },
  noShows: { better: 'down', minPct: 5, minAbs: 0.5, show: 'pct' },
  cancellations: { better: 'down', minPct: 5, minAbs: 1, show: 'pct' },
  prepTime: { better: 'down', minPct: 3, minAbs: 0.5, show: 'pct' },
  unprinted: { better: 'down', minPct: 0, minAbs: 1, show: 'abs' },
  failedPayments: { better: 'down', minPct: 0, minAbs: 1, show: 'abs' },
}

export interface Trend {
  tone: TrendTone
  /** Åt vilket håll talet gick; null när det inte gick att jämföra. */
  direction: 'up' | 'down' | 'flat' | null
  /** Det som står bredvid talet: "+12 %", "-3", "oförändrat", "ny" eller "". */
  text: string
  /** Hela meningen för skärmläsare: "upp 12 % mot förra veckan". */
  spoken: string
}

const NONE: Trend = { tone: 'neutral', direction: null, text: '', spoken: '' }

function fmtNumber(n: number, digits: number): string {
  return n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

/** "12 %", "4,5 %": en decimal under tio, som Statistik. */
function fmtPercent(n: number): string {
  return `${fmtNumber(n, n < 10 ? 1 : 0)} %`
}

/**
 * Tonen för ett tal mot jämförelsen. `against` är vad det jämförs med, i
 * den form som passar efter "mot" ("förra veckan", "förra perioden").
 * Utan jämförelse (null), på noll eller med en för liten förändring blir
 * det neutralt.
 */
export function trendOf(
  current: number | null | undefined,
  previous: number | null | undefined,
  metric: TrendMetric,
  against: string,
): Trend {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return NONE
  const rule = RULES[metric]
  const versus = against ? ` mot ${against}` : ''
  // Noll är en nystart (dagen har just börjat, ingen data än), inget betyg.
  if (current === 0) return NONE
  if (previous === 0) return { tone: 'neutral', direction: 'up', text: 'ny', spoken: `nytt${versus}, inget att jämföra med` }

  const diff = current - previous
  const pct = (diff / Math.abs(previous)) * 100
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const counts = direction !== 'flat' && Math.abs(diff) >= rule.minAbs && Math.abs(pct) >= rule.minPct
  const tone: TrendTone = !counts ? 'neutral' : (direction === 'up') === (rule.better === 'up') ? 'good' : 'bad'

  const amount = rule.show === 'abs' ? fmtNumber(Math.abs(diff), 1) : fmtPercent(Math.abs(pct))
  if (direction === 'flat' || amount === fmtPercent(0) || amount === '0') {
    return { tone: 'neutral', direction: 'flat', text: 'oförändrat', spoken: `oförändrat${versus}` }
  }
  const sign = direction === 'up' ? '+' : '-'
  return {
    tone,
    direction,
    text: `${sign}${amount}`,
    spoken: `${direction === 'up' ? 'upp' : 'ned'} ${amount}${versus}`,
  }
}

/** Klassen som färgar själva talet: grönt, rött eller vanlig text. */
export function toneClass(tone: TrendTone): string {
  return tone === 'neutral' ? '' : ` trend-value--${tone}`
}
