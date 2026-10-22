/** Skalor och axelvärden för diagrammen (charts.tsx). */

export function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

/** Kompakta axelvärden: "2 tkr", "12", "1,5 mkr". */
export function tickLabel(v: number, unit: 'kr' | 'count'): string {
  if (unit === 'count') return v.toLocaleString('sv-SE', { maximumFractionDigits: v < 10 ? 1 : 0 })
  const kr = v / 100
  if (kr >= 1_000_000) return `${(kr / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} mkr`
  if (kr >= 1000) return `${(kr / 1000).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} tkr`
  return `${kr.toLocaleString('sv-SE', { maximumFractionDigits: 0 })} kr`
}

/** Fem steg, ljust till mörkt bläck: samma färg, bara styrkan ändras. */
export const HEAT_STEPS = [20, 40, 60, 80, 101]

export function heatStep(value: number | null): number {
  if (value === null) return -1
  return HEAT_STEPS.findIndex((limit) => Math.min(value, 100) < limit)
}
