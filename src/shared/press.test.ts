import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRESS_MIN_MS, pressIn } from './press'

describe('pressIn', () => {
  afterEach(() => vi.useRealTimers())

  it('squeezes on press and lets go on release, after at least the minimum', () => {
    vi.useFakeTimers()
    const btn = document.createElement('button')
    const release = pressIn(btn)
    expect(btn.classList.contains('is-pressed')).toBe(true)
    release()
    // a very quick tap still shows the squeeze for PRESS_MIN_MS
    expect(btn.classList.contains('is-pressed')).toBe(true)
    vi.advanceTimersByTime(PRESS_MIN_MS)
    expect(btn.classList.contains('is-pressed')).toBe(false)
    expect(btn.classList.contains('is-released')).toBe(true)
    vi.advanceTimersByTime(200)
    expect(btn.classList.contains('is-released')).toBe(false)
  })

  it('dims a text link instead of squeezing it', () => {
    const a = document.createElement('a')
    a.href = '#'
    pressIn(a)
    expect(a.classList.contains('is-pressed-text')).toBe(true)
  })

  it('releases only once', () => {
    vi.useFakeTimers()
    const btn = document.createElement('button')
    const release = pressIn(btn)
    vi.advanceTimersByTime(PRESS_MIN_MS)
    release()
    release()
    expect(btn.classList.contains('is-pressed')).toBe(false)
  })

  it("adds the squeeze to the element's own transition inline and gives it back after", () => {
    vi.useFakeTimers()
    const btn = document.createElement('button')
    btn.style.transition = 'color 1s'
    document.body.appendChild(btn)
    const release = pressIn(btn)
    expect(btn.style.transition).toContain('scale')
    release()
    vi.advanceTimersByTime(PRESS_MIN_MS + 200)
    expect(btn.style.transition).toBe('color 1s')
    btn.remove()
  })
})
