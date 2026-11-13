import { useCallback, useSyncExternalStore } from 'react'
import { THEME_KEY } from './storageRegistry'

/**
 * Ljust och mörkt läge. Valet ligger i localStorage (booqy-theme) och på
 * <html data-theme>; public/theme.v2.js sätter attributet innan sidan
 * ritas, så att den aldrig blinkar ljus före mörk. Utan val är admin
 * ljust (standard). Samma nyckel i alla Booqys appar.
 */

export type Theme = 'light' | 'dark'

export const DEFAULT_THEME: Theme = 'light'

/** Färgen webbläsarens egen ram får (meta theme-color): skrivbordet. */
const THEME_COLOR: Record<Theme, string> = { light: '#f6f1ea', dark: '#1a120e' }

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

/**
 * Skrivbordsappen läser data-glass-theme (inte data-theme) för systemets
 * glas. Under ett byte hålls det kvar på det gamla läget tills svepet är
 * klart, så att den gamla bilden aldrig ligger över det nya glaset.
 */
let holdGlass = false

/** Sätter läget på sidan (attribut och ramfärg) utan att spara det. */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  if (!holdGlass) document.documentElement.dataset.glassTheme = theme
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

/**
 * Byter läge med ett svep: de nya färgerna växer ut i en cirkel från
 * klickpunkten (View Transitions, 480 ms). Under bytet är alla övergångar av
 * (.theme-switching), så att ingen yta tonar genom grått.
 *
 * Skrivbordsappen: systemets glas kan inte vara i två lägen samtidigt. Den
 * gamla bilden ligger därför kvar på det gamla glaset under hela svepet, och
 * den nya får en tät botten i ungefär det nya glasets färg (.theme-settling).
 * När svepet är klart byter skalet glaset (data-glass-theme) och botten tonar
 * bort på 200 ms. "Minska rörelse" eller ingen View Transitions: direkt byte.
 */
export function switchTheme(theme: Theme, origin?: { x: number; y: number }) {
  const root = document.documentElement
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> }
  }
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || typeof doc.startViewTransition !== 'function') {
    setTheme(theme)
    return
  }
  const desktop = root.classList.contains('is-desktop-glass')
  root.classList.add('theme-switching')
  if (desktop) {
    root.dataset.glassTheme = currentTheme()
    holdGlass = true
  }
  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? window.innerHeight / 2
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const transition = doc.startViewTransition(() => setTheme(theme))
  const done = () => {
    if (desktop) {
      holdGlass = false
      root.dataset.glassTheme = theme
      // Skalet byter glaset inom ett par bildrutor; sedan tonar botten bort.
      window.setTimeout(() => {
        root.classList.remove('theme-switching')
        requestAnimationFrame(() => root.classList.remove('theme-settling'))
      }, 120)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
  }
  transition.finished.then(done, done)
  transition.ready.then(() => {
    const sweep = root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 480, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
    )
    // Cirkeln täcker allt: nu får sidan den nya botten under bilden.
    if (desktop) sweep.finished.then(() => root.classList.add('theme-settling'), () => root.classList.add('theme-settling'))
  }, () => {})
}

export function useTheme(): { theme: Theme; toggle: (origin?: { x: number; y: number }) => void; setTheme: (theme: Theme) => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME)
  const toggle = useCallback((origin?: { x: number; y: number }) => switchTheme(currentTheme() === 'dark' ? 'light' : 'dark', origin), [])
  return { theme, toggle, setTheme }
}
