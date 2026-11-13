import { GLASS_BACKDROP_KEY } from './storageRegistry'

/**
 * Bakgrunden bakom glaset ("Bakgrund" under Inställningar, Utseende och ljud).
 *
 * - Genomskinligt (standard, inget sparat): i skrivbordsappen syns det som
 *   ligger bakom fönstret; i webbläsaren Booqys bakgrund.
 * - Färg (bara om man väljer det): glaset ligger över ett mjukt färgfält i den
 *   valda färgen. I skrivbordsappen täcker fältet systemets glas helt, så
 *   inget behöver bytas i skalet och inget kan blinka.
 *
 * - Egen bild (bara om man väljer det): glaset ligger över användarens bild,
 *   som sparas på servern och följer med till andra enheter. Valet av läge
 *   sparas per enhet ("image"); själva bilden hämtas från servern. Tills
 *   bilden är avkodad visas Booqys bakgrund, så att inget blinkar.
 *
 * Ett okänt eller trasigt sparat värde räknas som inget val: ingen flyttas
 * någonsin till Färg eller Egen bild utan att själv ha valt det.
 */

export type GlassBackdrop = { mode: 'clear' } | { mode: 'colour'; colour: string } | { mode: 'image' }

export const SWATCHES: readonly { name: string; colour: string }[] = [
  { name: 'Vin', colour: '#6b1d24' },
  { name: 'Valnöt', colour: '#5a3a26' },
  { name: 'Sand', colour: '#c9ae8c' },
  { name: 'Salvia', colour: '#7f9479' },
  { name: 'Skiffer', colour: '#566370' },
  { name: 'Plommon', colour: '#5f3a57' },
]

const HEX = /^#[0-9a-f]{6}$/i

export function parseGlassBackdrop(value: string | null | undefined): GlassBackdrop {
  if (value === 'image') return { mode: 'image' }
  return value && HEX.test(value) ? { mode: 'colour', colour: value.toLowerCase() } : { mode: 'clear' }
}

/** Var bilden finns: sätts av appen (API:t). Ger en adress, eller null om ingen bild finns. */
type ImageSource = () => Promise<string | null>
let imageSource: ImageSource = async () => null
let imageUrl: string | null = null
export function setBackdropImageSource(fn: ImageSource): void {
  imageSource = fn
}

/** Hämtar och avkodar bilden innan den visas, så att den aldrig ritas halvfärdig. */
async function decoded(url: string): Promise<boolean> {
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return true
  } catch {
    return false
  }
}

export function readGlassBackdrop(): GlassBackdrop {
  try {
    return parseGlassBackdrop(localStorage.getItem(GLASS_BACKDROP_KEY))
  } catch {
    return { mode: 'clear' }
  }
}

export function applyGlassBackdrop(b: GlassBackdrop, root: HTMLElement = document.documentElement): void {
  root.style.removeProperty('--user-colour')
  root.style.removeProperty('--user-image')
  if (b.mode === 'colour') {
    root.dataset.glassBackdrop = 'colour'
    root.style.setProperty('--user-colour', b.colour)
  } else if (b.mode === 'image') {
    // Utan avkodad bild: Booqys bakgrund (också i skrivbordsappen) tills den finns.
    if (imageUrl) {
      root.dataset.glassBackdrop = 'image'
      root.style.setProperty('--user-image', `url("${imageUrl.replace(/"/g, '%22')}")`)
    } else {
      root.dataset.glassBackdrop = 'image-loading'
    }
  } else {
    delete root.dataset.glassBackdrop
  }
}

const listeners = new Set<() => void>()
export function subscribeGlassBackdrop(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function store(b: GlassBackdrop) {
  try {
    if (b.mode === 'colour') localStorage.setItem(GLASS_BACKDROP_KEY, b.colour)
    else if (b.mode === 'image') localStorage.setItem(GLASS_BACKDROP_KEY, 'image')
    else localStorage.removeItem(GLASS_BACKDROP_KEY)
  } catch {
    // utan lagring gäller valet tills sidan laddas om
  }
}

/** Sparar och visar valet med samma svep som ljust/mörkt (från klickpunkten). */
export function setGlassBackdrop(b: GlassBackdrop, origin?: { x: number; y: number }): void {
  const next = b.mode === 'colour' ? parseGlassBackdrop(b.colour) : b
  store(next)
  const root = document.documentElement
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> }
  }
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const update = () => {
    applyGlassBackdrop(next, root)
    for (const fn of listeners) fn()
  }
  if (reduce || typeof doc.startViewTransition !== 'function') {
    update()
    return
  }
  root.classList.add('theme-switching')
  const x = origin?.x ?? window.innerWidth / 2
  const y = origin?.y ?? window.innerHeight / 2
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  const transition = doc.startViewTransition(update)
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
  transition.finished.then(done, done)
  transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 480, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  }, () => {})
}

/** Hämtar (om) användarens bild; sveper in den när den är avkodad. Ger true om en bild finns. */
export async function refreshBackdropImage(origin?: { x: number; y: number }): Promise<boolean> {
  let url: string | null = null
  try {
    url = await imageSource()
  } catch {
    url = null
  }
  if (!url || !(await decoded(url))) {
    imageUrl = null
    for (const fn of listeners) fn()
    return false
  }
  imageUrl = url
  if (readGlassBackdrop().mode === 'image') setGlassBackdrop({ mode: 'image' }, origin)
  else for (const fn of listeners) fn()
  return true
}

export function hasBackdropImage(): boolean {
  return imageUrl !== null
}

export function forgetBackdropImage(): void {
  imageUrl = null
}

export function installGlassBackdrop(): void {
  if (typeof document === 'undefined') return
  const choice = readGlassBackdrop()
  applyGlassBackdrop(choice)
  window.addEventListener('storage', (e) => {
    if (e.key === GLASS_BACKDROP_KEY) {
      applyGlassBackdrop(readGlassBackdrop())
      for (const fn of listeners) fn()
    }
  })
}
