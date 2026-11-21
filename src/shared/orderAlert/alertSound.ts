import { useSyncExternalStore } from 'react'
import { ORDER_SOUND_KEY } from '../storageRegistry'

/**
 * Larmljudet för en ny onlinebeställning: ett högt, klart "ding-DING" två
 * gånger (ca 1,8 s), tydligt annorlunda än klickljudet (shared/press.ts).
 *
 * Samma sätt som klicket, som hörs i Safari: ljudet räknas ut en gång i
 * vanlig JavaScript och spelas som en enda buffert genom en förstärkning.
 * Inga filter eller oscillatorer. Nästan full styrka, oberoende av klickets
 * volym och av klickljudet på eller av; Inställningar, Den här enheten,
 * Utseende och ljud stänger av det på den här enheten ("booqy-order-sound").
 *
 * Webbläsarna (Safari på iPad först) släpper bara fram ljud efter ett tryck.
 * Därför får varje tryck, klick eller tangent (även Logga in) väcka en egen
 * ljudmotor för larmet. Kommer en beställning innan någon har tryckt, eller
 * har motorn somnat (viloläge, annan ljudutgång), spelas inget och rutan
 * visar "Tryck för att slå på ljudet" (OrderAlert.tsx).
 */

/** Förstärkningen: nästan full styrka (proverna toppar på 0,95). */
export const ALERT_GAIN = 1
/** Tonerna: E6 och A6, en kvart upp. */
const NOTES: [number, number] = [1318.5, 1760]
/** När varje slag börjar (s) och vilken ton. */
const STRIKES: [number, 0 | 1][] = [
  [0, 0],
  [0.16, 1],
  [0.62, 0],
  [0.78, 1],
]
/** Klockans deltoner: [tonens gånger, styrka, avklingning s]. */
const PARTIALS: [number, number, number][] = [
  [1, 1, 0.5],
  [2, 0.3, 0.32],
  [2.76, 0.42, 0.22],
  [5.4, 0.22, 0.1],
  [8.93, 0.1, 0.05],
]
const LENGTH_S = 1.8

/**
 * Larmet som färdiga ljudprover vid samplingsfrekvensen `sr`. Mjukt
 * mättat (tanh) så att det låter högt utan att klippa, toppen 0,95.
 */
export function chimeSamples(sr: number): Float32Array {
  const n = Math.ceil(sr * LENGTH_S)
  const out = new Float32Array(n)
  for (const [start, note] of STRIKES) {
    const f = NOTES[note]
    const from = Math.floor(start * sr)
    for (let i = from; i < n; i++) {
      const t = (i - from) / sr
      if (t > 1.2) break
      const attack = Math.min(1, t / 0.002)
      let v = 0
      for (const [mult, amp, decay] of PARTIALS) v += amp * Math.exp(-t / decay) * Math.sin(2 * Math.PI * f * mult * t)
      // det andra slaget i varje par lite starkare: "ding-DING"
      out[i] += attack * v * (note === 1 ? 1 : 0.8)
    }
  }
  let max = 0
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i]))
  if (max === 0) return out
  const drive = 1.8
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) out[i] = (0.95 * Math.tanh((drive * out[i]) / max)) / norm
  // mjukt slut, inget klick
  const fade = Math.floor(sr * 0.05)
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade
  return out
}

function storedOn(): boolean {
  try {
    return localStorage.getItem(ORDER_SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

let on: boolean | null = null
const listeners = new Set<() => void>()

/** Spelar den här enheten larmljudet? På från början. */
export function orderSoundOn(): boolean {
  if (on === null) on = storedOn()
  return on
}

export function setOrderSound(next: boolean) {
  on = next
  try {
    localStorage.setItem(ORDER_SOUND_KEY, next ? 'on' : 'off')
  } catch {
    /* privat läge utan lagring: valet gäller tills sidan laddas om */
  }
  for (const l of [...listeners]) l()
}

export function useOrderSound(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    orderSoundOn,
    () => true,
  )
  return [value, setOrderSound]
}

// --- Ljudmotorn -----------------------------------------------------------------

let ctx: AudioContext | null = null
/** Något har gjort motorn opålitlig (Safari: avbruten, fliken tillbaka): nästa tryck ger en ny. */
let stale = false
/** När motorn senast skapades, spelade eller väcktes av ett tryck. */
let freshAt = 0
/** Ett tryck efter så här lång tystnad ger en ny motor (som klicket, se press.ts). */
const IDLE_MS = 30_000
const buffers = new Map<number, AudioBuffer>()
/** Vem som vill veta när ljudet går att spela igen (rutans tips). */
const unlockListeners = new Set<() => void>()

function AudioCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null
}

function notifyUnlocked(c: AudioContext) {
  if (c === ctx && c.state === 'running' && unlockListeners.size) for (const l of [...unlockListeners]) l()
}

function create(): AudioContext | null {
  const AC = AudioCtor()
  if (!AC) return null
  try {
    const c = new AC()
    c.onstatechange = () => {
      if ((c.state as string) === 'interrupted') stale = true
      notifyUnlocked(c)
    }
    ctx = c
    stale = false
    freshAt = Date.now()
    return c
  } catch {
    return null
  }
}

function bufferFor(c: AudioContext): AudioBuffer {
  let buf = buffers.get(c.sampleRate)
  if (!buf) {
    const samples = chimeSamples(c.sampleRate)
    buf = c.createBuffer(1, samples.length, c.sampleRate)
    buf.getChannelData(0).set(samples)
    buffers.set(c.sampleRate, buf)
  }
  return buf
}

function sound(c: AudioContext): boolean {
  try {
    const src = c.createBufferSource()
    src.buffer = bufferFor(c)
    const gain = c.createGain()
    gain.gain.value = ALERT_GAIN
    src.connect(gain)
    gain.connect(c.destination)
    src.start(0)
    freshAt = Date.now()
    return true
  } catch {
    return false
  }
}

/**
 * Inne i ett tryck: se till att motorn går (en ny om den gamla är stängd,
 * avbruten eller har varit tyst länge), med en tyst prov så att Safari
 * släpper fram den. Ett tryck är det enda tillfället en ny motor får starta.
 */
export function unlockOrderAudio(): AudioContext | null {
  if (!orderSoundOn()) return null
  try {
    let c = ctx
    // Ett släpp som avslutade en rullning är inget tryck för webbläsaren: då
    // byts ingen fungerande motor ut mot en ny som inte får starta.
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
    if (activation && !activation.isActive) {
      if (c && c.state !== 'closed' && c.state !== 'running') void c.resume().then(() => notifyUnlocked(c!), () => {})
      return c
    }
    if (c && (stale || c.state === 'closed' || Date.now() - freshAt > IDLE_MS)) {
      c.close().catch(() => {})
      ctx = null
      c = null
    }
    if (!c) {
      c = create()
      if (!c) return null
      const silent = c.createBufferSource()
      silent.buffer = c.createBuffer(1, 1, c.sampleRate)
      silent.connect(c.destination)
      silent.start(0)
      bufferFor(c)
    } else {
      freshAt = Date.now()
    }
    const ready = c
    // Safari kan starta motorn direkt i "running" utan statechange: säg till ändå.
    if (ready.state === 'running') notifyUnlocked(ready)
    else void ready.resume().then(() => notifyUnlocked(ready), () => {})
    return ready
  } catch {
    return null
  }
}

let installed = false

/** Varje tryck, klick och tangent håller larmets ljudmotor vaken (main.tsx). */
export function installOrderAlertAudio() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const unlock = () => {
    unlockOrderAudio()
  }
  for (const type of ['pointerup', 'click', 'touchend', 'keydown']) {
    document.addEventListener(type, unlock, { capture: true, passive: true })
  }
  // Tillbaka till fliken: den gamla motorn spelar fortfarande om den går,
  // men nästa tryck ger en ny som hör till den ljudutgång som gäller nu.
  document.addEventListener('visibilitychange', () => {
    if (ctx && document.visibilityState === 'visible') stale = true
  })
}

export type ChimeResult = 'played' | 'locked' | 'off'

/** Hur länge ett försök att väcka motorn utan tryck får ta. */
const WAKE_MS = 400

/**
 * Larmet, utan tryck (en ny beställning kom). `played` = ljudet gick ut,
 * `locked` = webbläsaren släpper inte fram ljud förrän någon trycker,
 * `off` = avstängt på den här enheten. Telefoner som kan vibrera gör det.
 */
export async function playOrderAlert(): Promise<ChimeResult> {
  if (!orderSoundOn()) return 'off'
  try {
    navigator.vibrate?.([220, 120, 220])
  } catch {
    /* ingen vibration */
  }
  try {
    // Ingen motor än: en ny får gå i de webbläsare som minns ett tidigare tryck (Chrome).
    const c = ctx && ctx.state !== 'closed' ? ctx : create()
    if (!c) return 'locked'
    if (c.state !== 'running') {
      await Promise.race([
        c.resume().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, WAKE_MS)),
      ])
    }
    if (c.state !== 'running') return 'locked'
    return sound(c) ? 'played' : 'locked'
  } catch {
    return 'locked'
  }
}

/** Rutans "Tryck för att slå på ljudet" och Inställningarnas Testa: inne i ett tryck. */
export function testOrderSound(): boolean {
  const c = unlockOrderAudio()
  if (!c) return false
  if (c.state === 'running') return sound(c)
  c.resume().then(() => sound(c), () => {})
  return true
}

/** Säg till när larmets ljud går igen (motorn har vaknat efter ett tryck). */
export function onOrderAudioUnlocked(listener: () => void): () => void {
  unlockListeners.add(listener)
  return () => unlockListeners.delete(listener)
}

/** Bara för tester. */
export function resetOrderAlertAudio() {
  ctx = null
  stale = false
  freshAt = 0
  on = null
  buffers.clear()
}
