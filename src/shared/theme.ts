import { useCallback, useSyncExternalStore } from 'react'
import { THEME_KEY } from './storageRegistry'

/**
 * Ljust och mörkt läge. Valet ligger i localStorage (booqy-theme) och på
 * <html data-theme>; public/theme.v1.js sätter attributet innan sidan
 * ritas, så att den aldrig blinkar ljus före mörk. Utan val är admin
 * ljust (standard). Samma nyckel i alla Booqys appar.
 */

export type Theme = 'light' | 'dark'

export const DEFAULT_THEME: Theme = 'light'

/** Färgen webbläsarens egen ram får (meta theme-color): skrivbordet. */
const THEME_COLOR: Record<Theme, string> = { light: '#f1eee6', dark: '#1c1918' }

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

/** Läget just nu: det som sitter på <html>, annars det sparade, annars standard. */
export function currentTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (isTheme(attr)) return attr
  }
  return storedTheme() ?? DEFAULT_THEME
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Sätter läget på sidan (attribut och ramfärg) utan att spara det. */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_COLOR[theme]
  }
  emit()
}

/** Sparar valet och sätter det. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* privat läge utan lagring: valet gäller tills sidan laddas om */
  }
  applyTheme(theme)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Byte i en annan flik följer med hit.
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY && isTheme(e.newValue)) applyTheme(e.newValue)
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useTheme(): { theme: Theme; toggle: () => void; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME)
  const toggle = useCallback(() => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggle, setTheme }
}
