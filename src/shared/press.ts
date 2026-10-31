import { useSyncExternalStore } from 'react'
import { SOUND_KEY } from './storageRegistry'

/**
 * Tryckkänsla, samma som booqy.se och Booqy Console: ett varmt, klassiskt
 * klickljud (Web Audio, skapat i stunden, inga filer) och en klämning plus
 * en brun krusning, vid tryck och vid Enter eller mellanslag. Aldrig vid
 * hovring. Ljudet är på från början och startar vid första trycket
 * (webbläsarnas regler för ljud); Inställningar, Utseende och ljud stänger av det
 * ("booqy-sound" i localStorage). Minska rörelse: krusningen blir en kort
 * blinkning, ljudet är kvar.
 */

const TARGETS =
  "a[href], button, summary, [role='tab'], [role='button'], label[for], select, input[type='checkbox'], input[type='radio']"
const BLOCK = "button, summary, [role='tab'], [role='button'], .btn, .admin-nav-item, .stat-tile--link"
const CTA = ".btn.primary, button[type='submit']"

// Ett klassiskt klick, som en bra strömbrytare, men varmt: en mycket kort
// brusstöt som klingar på en ton, med en mjuk låg duns under. Ett lätt tick för
// länkar, ett fylligare klick för knappar och ett djupare för huvudknapparna.
// [ton Hz, längd s, volym]
const VOICES: Record<'tick' | 'press' | 'cta', [number, number, number]> = {
  tick: [3400, 0.028, 0.32],
  press: [2600, 0.034, 0.42],
  cta: [1900, 0.04, 0.5],
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
    // Safari starts the audio asleep: wake it, then play once it is running
    if (ctx.state !== 'running') {
      const c = ctx
      c.resume().then(() => {
        if (c.state === 'running') play(kind)
      }, () => {})
      return
    }
    const [pitch, len, vol] = VOICES[kind]
    const t = ctx.currentTime
    const soft = ctx.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 6000
    soft.connect(ctx.destination)
    // the click: noise that dies away fast, ringing at one pitch
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const ring = ctx.createBiquadFilter()
    ring.type = 'bandpass'
    ring.frequency.value = pitch
    ring.Q.value = 4
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    src.connect(ring).connect(g).connect(soft)
    src.start(t)
    src.stop(t + len)
    // the warmth: a soft low thump under it
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(pitch / 8, t)
    osc.frequency.exponentialRampToValueAtTime(pitch / 14, t + 0.02)
    const og = ctx.createGain()
    og.gain.setValueAtTime(vol * 0.35, t)
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.02)
    osc.connect(og).connect(soft)
    osc.start(t)
    osc.stop(t + 0.025)
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
  // Safari only lets audio start inside a click or key press, so the first
  // one also wakes the audio up for the presses that follow
  const unlock = () => {
    if (!on) return
    try {
      if (!ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        ctx = new AC()
      }
      if (ctx.state !== 'running') void ctx.resume()
    } catch {
      /* no audio */
    }
  }
  for (const type of ['click', 'touchend', 'keydown']) document.addEventListener(type, unlock, { capture: true, passive: true })
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
