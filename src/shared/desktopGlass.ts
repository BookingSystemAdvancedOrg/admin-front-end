/**
 * Genomskinligt skrivbordsfönster. Booqys skrivbordsapp (desktop/main.cjs)
 * lägger till "BooqyGlass/<läge>" i user agent när fönstret är genomskinligt:
 * vibrancy (macOS), acrylic (Windows 11) eller tint (Linux, utan oskärpa).
 * Då får <html> klassen is-desktop-glass och data-desktop-glass=<läge>, och
 * CSS:en gör sidan genomskinlig så att skrivbordet syns igenom. I en vanlig
 * webbläsare händer ingenting.
 */
import { showDesktopHint } from './desktopHint'
import { installGlassBackdrop } from './glassBackdrop'

export type DesktopGlass = 'vibrancy' | 'acrylic' | 'tint'

export function desktopGlassMode(userAgent: string): DesktopGlass | null {
  const m = /\bBooqyGlass\/(vibrancy|acrylic|tint)\b/.exec(userAgent)
  return m ? (m[1] as DesktopGlass) : null
}

export function installDesktopGlass(): DesktopGlass | null {
  installGlassBackdrop()
  // Den borttagna Bakgrund-inställningen sparade en bild här; städa bort den.
  try {
    localStorage.removeItem('booqy-backdrop')
  } catch {
    // ingen lagring, inget att städa
  }
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return null
  const mode = desktopGlassMode(navigator.userAgent)
  if (!mode) {
    // I webbläsaren: en gång, ett tips om appen (den ser skrivbordet, sidan kan inte).
    window.setTimeout(showDesktopHint, 2500)
    return null
  }
  const root = document.documentElement
  root.classList.add('is-desktop-glass')
  root.dataset.desktopGlass = mode
  return mode
}
