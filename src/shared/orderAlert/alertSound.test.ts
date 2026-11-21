import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORDER_SOUND_KEY } from '../storageRegistry'
import {
  ALERT_GAIN,
  chimeSamples,
  orderSoundOn,
  playOrderAlert,
  resetOrderAlertAudio,
  setOrderSound,
  testOrderSound,
  unlockOrderAudio,
} from './alertSound'

/** En ljudmotor som i webbläsaren: startar "suspended" utan tryck, "running" efter resume (om tillåtet). */
class FakeContext {
  static allowResume = true
  static made: FakeContext[] = []
  state: AudioContextState = 'suspended'
  sampleRate = 48000
  onstatechange: (() => void) | null = null
  started: { gain: number; length: number }[] = []
  destination = {}
  constructor() {
    FakeContext.made.push(this)
  }
  resume() {
    if (FakeContext.allowResume) {
      this.state = 'running'
      this.onstatechange?.()
    }
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
  createBuffer(_ch: number, length: number) {
    const data = new Float32Array(length)
    return { length, getChannelData: () => data }
  }
  createGain() {
    return { gain: { value: 0 }, connect: () => {} }
  }
  createBufferSource() {
    const src = {
      buffer: null as { length: number } | null,
      gainNode: null as { gain?: { value: number } } | null,
      connect: (g: { gain?: { value: number } }) => {
        src.gainNode = g
      },
      start: () => this.started.push({ gain: src.gainNode?.gain?.value ?? -1, length: src.buffer?.length ?? 0 }),
    }
    return src
  }
}

beforeEach(() => {
  resetOrderAlertAudio()
  localStorage.removeItem(ORDER_SOUND_KEY)
  FakeContext.allowResume = true
  FakeContext.made = []
  vi.stubGlobal('AudioContext', FakeContext)
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetOrderAlertAudio()
  localStorage.removeItem(ORDER_SOUND_KEY)
})

describe('order alert sound', () => {
  it('is a loud, clean pre-rendered chime (about 1.8 s, peak just under 1)', () => {
    const s = chimeSamples(48000)
    expect(s.length).toBe(Math.ceil(48000 * 1.8))
    let peak = 0
    let energy = 0
    for (const v of s) {
      peak = Math.max(peak, Math.abs(v))
      energy += v * v
    }
    expect(peak).toBeGreaterThan(0.9)
    expect(peak).toBeLessThanOrEqual(0.951)
    // Högt: medeleffekten under första sekunden är tydlig, inte ett tunt pip.
    expect(Math.sqrt(energy / s.length)).toBeGreaterThan(0.1)
    expect(Math.abs(s[s.length - 1])).toBeLessThan(1e-3)
    expect(ALERT_GAIN).toBeGreaterThanOrEqual(0.9)
  })

  it('plays at near full gain once the audio is unlocked by a tap', async () => {
    unlockOrderAudio()
    expect(await playOrderAlert()).toBe('played')
    const c = FakeContext.made.at(-1)!
    const chime = c.started.find((x) => x.length > 1)!
    expect(chime.gain).toBe(ALERT_GAIN)
  })

  it('reports locked when the browser will not start audio without a tap', async () => {
    FakeContext.allowResume = false
    vi.useFakeTimers()
    const result = playOrderAlert()
    await vi.advanceTimersByTimeAsync(500)
    expect(await result).toBe('locked')
    vi.useRealTimers()
  })

  it('is off per device and remembers it', async () => {
    expect(orderSoundOn()).toBe(true)
    setOrderSound(false)
    expect(localStorage.getItem(ORDER_SOUND_KEY)).toBe('off')
    expect(await playOrderAlert()).toBe('off')
    expect(testOrderSound()).toBe(false)
    resetOrderAlertAudio()
    expect(orderSoundOn()).toBe(false)
  })

  it('Testa plays it inside the tap', () => {
    expect(testOrderSound()).toBe(true)
    const c = FakeContext.made.at(-1)!
    expect(c.started.some((x) => x.length > 1)).toBe(true)
  })
})
