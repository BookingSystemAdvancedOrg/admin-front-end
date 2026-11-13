import { BACKDROP_KEY } from './storageRegistry'

/**
 * Egen bakgrund bakom glaset ("Bakgrund" under Inställningar, Utseende och ljud).
 *
 * En webbsida kan inte se enhetens bakgrundsbild (varken webbläsare, iOS eller
 * Android lämnar ut den), så användaren väljer själv en bild, till exempel sin
 * skrivbordsbild. Den förminskas i webbläsaren, sparas bara här (localStorage)
 * och läggs som --user-backdrop på <html>; glaset suddar den som allt annat.
 * I skrivbordsappen syns det riktiga skrivbordet i stället (desktopGlass.ts).
 */

const MAX_SIDE = 2400
const QUALITY = 0.82

export type BackdropError = 'not-image' | 'unreadable' | 'too-large'

function apply(dataUrl: string | null) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (dataUrl) {
    root.style.setProperty('--user-backdrop', `url("${dataUrl}")`)
    root.dataset.userBackdrop = 'on'
  } else {
    root.style.removeProperty('--user-backdrop')
    delete root.dataset.userBackdrop
  }
}

export function readBackdrop(): string | null {
  try {
    const v = localStorage.getItem(BACKDROP_KEY)
    return v && v.startsWith('data:image/') ? v : null
  } catch {
    return null
  }
}

export function installBackdrop() {
  apply(readBackdrop())
  if (typeof window === 'undefined') return
  window.addEventListener('storage', (e) => {
    if (e.key === BACKDROP_KEY) apply(readBackdrop())
  })
}

/** Skalar ner bilden så att längsta sidan är högst MAX_SIDE px och gör den till JPEG. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', QUALITY)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function saveBackdrop(file: File): Promise<BackdropError | null> {
  if (!file.type.startsWith('image/')) return 'not-image'
  let dataUrl: string
  try {
    dataUrl = await shrink(file)
  } catch {
    return 'unreadable'
  }
  try {
    localStorage.setItem(BACKDROP_KEY, dataUrl)
  } catch {
    return 'too-large'
  }
  apply(dataUrl)
  return null
}

export function clearBackdrop() {
  try {
    localStorage.removeItem(BACKDROP_KEY)
  } catch {
    // Lagringen är avstängd: då finns inget sparat heller.
  }
  apply(null)
}
