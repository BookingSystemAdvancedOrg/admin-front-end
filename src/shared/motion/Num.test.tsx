import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Num } from './Num'

const reduced = window.matchMedia
function allowMotion() {
  window.matchMedia = (query: string) =>
    ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList
}

describe('Num', () => {
  let now = 0
  beforeEach(() => {
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      now += 100
      setTimeout(() => cb(now), 0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })
  afterEach(() => {
    window.matchMedia = reduced
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('counts fast at first and lands exactly on the formatted value', async () => {
    allowMotion()
    const { container } = render(<Num>1 250 kr</Num>)
    const el = container.firstChild as HTMLElement
    expect(el.textContent).toBe('0 kr')
    await act(() => new Promise((r) => setTimeout(r, 0)))
    const early = Number(el.textContent!.replace(/\D/g, ''))
    expect(early).toBeGreaterThan(500) // already past half after a tenth of the time
    expect(early).toBeLessThan(1250)
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(el.textContent).toBe('1 250 kr')
  })

  it('reports how far the number has grown so its colour can follow, then clears it', async () => {
    allowMotion()
    const { container } = render(<Num>1 250 kr</Num>)
    const el = container.firstChild as HTMLElement
    expect(el.style.getPropertyValue('--count')).toBe('0.000')
    await act(() => new Promise((r) => setTimeout(r, 0)))
    const mid = Number(el.style.getPropertyValue('--count'))
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(el.style.getPropertyValue('--count')).toBe('')
  })

  it('shows the value at once with reduced motion', () => {
    const { container } = render(<Num>6,9 %</Num>)
    expect(container.firstChild!.textContent).toBe('6,9 %')
  })
})
