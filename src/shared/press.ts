import { useSyncExternalStore } from 'react'
import { SOUND_KEY } from './storageRegistry'

/**
 * Tryckkänsla, samma som booqy.se och Booqy Console: ett mjukt, runt
 * klickljud (Web Audio, skapat i stunden, inga filer) och en klämning plus
 * en brun krusning, vid tryck och vid Enter eller mellanslag. Aldrig vid
 * hovring. Ljudet är på från början och startar vid första trycket
 * (webbläsarnas regler för ljud); knappen i sidomenyn stänger av det
 * ("booqy-sound" i localStorage). Minska rörelse: krusningen blir en kort
 * blinkning, ljudet är kvar.
 */

const TARGETS =
  "a[href], button, summary, [role='tab'], [role='button'], label[for], select, input[type='checkbox'], input[type='radio']"
const BLOCK = "button, summary, [role='tab'], [role='button'], .btn, .admin-nav-item, .stat-tile--link"
const CTA = ".btn.primary, button[type='submit']"

// Tre röster, alla mjuka trätoner: ett lätt tick för länkar, ett fylligare
// tryck för knappar och ett djupare för huvudknapparna. [grundton Hz, längd s, volym]
const VOICES: Record<'tick' | 'press' | 'cta', [number, number, number]> = {
  tick: [1100, 0.05, 0.035],
  press: [720, 0.07, 0.05],
  cta: [520, 0.09, 0.06],
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function storedSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

let on = storedSound()
let ctx: AudioContext | null = null
const listeners = new Set<() => void>()

export function soundOn(): boolean {
  return on
}

export function setSound(next: boolean) {
  on = next
  try {
    localStorage.setItem(SOUND_KEY, next ? 'on' : 'off')
  } catch {
    /* privat läge utan lagring: valet gäller tills sidan laddas om */
  }
  for (const listener of listeners) listener()
  if (next) play('press') // ett bekräftande klick när ljudet slås på
}

export function useSound(): [boolean, () => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    soundOn,
    () => true,
  )
  return [value, () => setSound(!value)]
}

function play(kind: keyof typeof VOICES) {
  if (!on) return
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    const [f0, len, vol] = VOICES[kind]
    const t = ctx.currentTime
    // allt går genom ett lågpassfilter som tar bort det vassa
    const soft = ctx.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 3200
    soft.connect(ctx.destination)
    // grundtonen glider nedåt som ett mjukt "tok", med en svag övton ovanpå
    for (const [mult, gain, decay] of [
      [1, vol, len],
      [2.4, vol * 0.22, len * 0.45],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(f0 * mult, t)
      osc.frequency.exponentialRampToValueAtTime(f0 * mult * 0.6, t + decay)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(gain, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      osc.connect(g).connect(soft)
      osc.start(t)
      osc.stop(t + decay + 0.01)
    }
  } catch {
    /* inget ljud: det synliga räcker */
  }
}

function kindOf(el: Element): keyof typeof VOICES {
  if (el.matches(CTA)) return 'cta'
  if (el.matches("button, summary, [role='tab'], [role='button'], .btn, select, input, label")) return 'press'
  return 'tick'
}

function visual(el: Element, x: number | null, y: number | null) {
  const cls = el.matches(BLOCK) ? 'is-pressed' : 'is-pressed-text'
  el.classList.add(cls)
  window.setTimeout(() => el.classList.remove(cls), 160)
  if (reducedMotion() || x == null || y == null) return
  const ripple = document.createElement('span')
  ripple.className = 'press-ripple'
  ripple.style.left = `${x}px`
  ripple.style.top = `${y}px`
  document.body.appendChild(ripple)
  window.setTimeout(() => ripple.remove(), 260)
}

let installed = false

/** Lyssnar en gång på dokumentet; varje tryck i appen får känslan. */
export function installPress() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.(TARGETS)
      if (!el || (el as HTMLButtonElement).disabled) return
      play(kindOf(el))
      visual(el, e.clientX, e.clientY)
    },
    { passive: true },
  )
  document.addEventListener('keydown', (e) => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return
    const el = document.activeElement
    if (!el || !el.matches(TARGETS) || el.matches("input[type='text'], input[type='email'], input[type='tel'], input[type='search'], input[type='password'], textarea")) return
    if (e.key === ' ' && el.matches('a[href]')) return
    const r = el.getBoundingClientRect()
    play(kindOf(el))
    visual(el, r.left + r.width / 2, r.top + r.height / 2)
  })
}
