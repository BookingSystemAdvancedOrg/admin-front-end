/**
 * Genomskinligt skrivbordsfönster. Booqys skrivbordsapp (desktop/main.cjs)
 * lägger till "BooqyGlass/<läge>" i user agent när fönstret är genomskinligt:
 * vibrancy (macOS), acrylic (Windows 11) eller tint (Linux, utan oskärpa).
 * Då får <html> klassen is-desktop-glass och data-desktop-glass=<läge>, och
 * CSS:en gör sidan genomskinlig så att skrivbordet syns igenom. I en vanlig
 * webbläsare händer ingenting.
 */
import { installBackdrop } from './backdrop'

export type DesktopGlass = 'vibrancy' | 'acrylic' | 'tint'

export function desktopGlassMode(userAgent: string): DesktopGlass | null {
  const m = /\bBooqyGlass\/(vibrancy|acrylic|tint)\b/.exec(userAgent)
  return m ? (m[1] as DesktopGlass) : null
}

export function installDesktopGlass(): DesktopGlass | null {
  // Den egna bakgrunden (backdrop.ts) hör till samma glasrum: i webbläsaren
  // ligger den bakom glaset, i skrivbordsappen syns skrivbordet i stället.
  installBackdrop()
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return null
  const mode = desktopGlassMode(navigator.userAgent)
  if (!mode) return null
  const root = document.documentElement
  root.classList.add('is-desktop-glass')
  root.dataset.desktopGlass = mode
  return mode
}
