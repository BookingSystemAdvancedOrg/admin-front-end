import type { CSSProperties } from 'react'

/** Efter så många rader kommer resten samtidigt (ux-motion 3: 6 till 8). */
export const STAGGER_CAP = 7

/**
 * Ordningen i en lista som kommer in en rad i taget: `--i` för CSS:ens
 * `calc(var(--i) * steg)`. Rad 8 och framåt delar den sista fördröjningen,
 * så att hela kaskaden aldrig blir längre än STAGGER_CAP steg.
 */
export function staggerIndex(i: number, cap = STAGGER_CAP): number {
  return Math.max(0, Math.min(Math.floor(i), cap))
}

export function staggerStyle(i: number, cap = STAGGER_CAP): CSSProperties {
  return { '--i': staggerIndex(i, cap) } as CSSProperties
}

/**
 * En serie som hör ihop (staplar i ett diagram): i stället för att de
 * första åtta kommer i tur och ordning och resten samtidigt sprids hela
 * serien jämnt över samma STAGGER_CAP steg, så att kaskaden aldrig blir längre.
 */
export function spreadIndex(i: number, n: number, cap = STAGGER_CAP): number {
  if (n <= cap + 1) return staggerIndex(i, cap)
  return Math.round((Math.max(0, Math.min(i, n - 1)) * cap * 100) / (n - 1)) / 100
}

export function spreadStyle(i: number, n: number, cap = STAGGER_CAP): CSSProperties {
  return { '--i': spreadIndex(i, n, cap) } as CSSProperties
}
