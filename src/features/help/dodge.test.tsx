import { useRef } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AWAY_CLASS, RETURN_AFTER_MS, YIELD_CLASS, useDodge, useHideOnScroll } from './dodge'

function Launcher() {
  const ref = useRef<HTMLButtonElement>(null)
  useDodge(ref, true)
  useHideOnScroll(ref, true)
  return <button ref={ref} type="button" className="help-launcher">Fråga Booqy</button>
}

let under: Element[] = []
let page: HTMLElement
/** The page's scroll area (the admin scrolls in its main column, not the window). */
const scrollPage = (y: number) => {
  Object.defineProperty(page, 'scrollTop', { value: y, configurable: true })
  page.dispatchEvent(new Event('scroll'))
}
const frame = () => act(() => { vi.advanceTimersByTime(50) })

beforeEach(() => {
  vi.useFakeTimers()
  under = []
  document.elementsFromPoint = () => under
  page = document.createElement('main')
  document.body.appendChild(page)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('Fråga Booqy launcher', () => {
  it('slides away while scrolling down and is back after a pause', () => {
    const { getByRole } = render(<Launcher />)
    const btn = getByRole('button')
    frame()
    expect(btn).not.toHaveClass(AWAY_CLASS)
    act(() => scrollPage(200))
    expect(btn).toHaveClass(AWAY_CLASS)
    act(() => { vi.advanceTimersByTime(RETURN_AFTER_MS + 10) })
    expect(btn).not.toHaveClass(AWAY_CLASS)
  })

  it('comes back at once on a scroll up', () => {
    const { getByRole } = render(<Launcher />)
    const btn = getByRole('button')
    act(() => scrollPage(300))
    expect(btn).toHaveClass(AWAY_CLASS)
    act(() => scrollPage(250))
    expect(btn).not.toHaveClass(AWAY_CLASS)
  })

  it('stays while it has keyboard focus', () => {
    const { getByRole } = render(<Launcher />)
    const btn = getByRole('button')
    act(() => btn.focus())
    act(() => scrollPage(300))
    expect(btn).not.toHaveClass(AWAY_CLASS)
  })

  it('steps aside from a control that scrolls with the page, and shows on focus', () => {
    const control = document.createElement('button')
    document.body.appendChild(control)
    under = [control]
    const { getByRole } = render(<Launcher />)
    const btn = getByRole('button', { name: 'Fråga Booqy' })
    frame()
    expect(btn).toHaveClass(YIELD_CLASS)
    act(() => btn.focus())
    frame()
    expect(btn).not.toHaveClass(YIELD_CLASS)
    act(() => btn.blur())
    act(() => { vi.advanceTimersByTime(1100) })
    expect(btn).toHaveClass(YIELD_CLASS)
    under = []
    act(() => { vi.advanceTimersByTime(1100) })
    expect(btn).not.toHaveClass(YIELD_CLASS)
  })

  it('floats up off a control it would cover and stays reachable (Översikt at 1280 x 720)', () => {
    const control = document.createElement('a')
    control.setAttribute('href', '/bokningar')
    document.body.appendChild(control)
    const vh = window.innerHeight
    // the control fills the bottom 80 px of a page that cannot scroll it free
    document.elementsFromPoint = (_x: number, y: number) => (y > vh - 80 ? [control] : [])
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1280)
    const { getByRole } = render(<Launcher />)
    const btn = getByRole('button', { name: 'Fråga Booqy' })
    frame()
    expect(btn).not.toHaveClass(YIELD_CLASS)
    expect(parseFloat(btn.style.getPropertyValue('--dodge'))).toBeGreaterThanOrEqual(80)
  })

  it('floats up above a pinned bar under it', () => {
    const bar = document.createElement('div')
    bar.style.position = 'fixed'
    document.body.appendChild(bar)
    const vh = window.innerHeight
    bar.getBoundingClientRect = () => ({ top: vh - 60, bottom: vh, left: 0, right: 400, width: 400, height: 60, x: 0, y: vh - 60, toJSON: () => ({}) })
    under = [bar]
    // jsdom has no layout: the button is 40 x 120 at the bottom right.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120)
    const { getByRole } = render(<Launcher />)
    const btn = getByRole('button')
    frame()
    expect(parseFloat(btn.style.getPropertyValue('--dodge'))).toBeGreaterThan(0)
    under = []
    act(() => { vi.advanceTimersByTime(1100) }) // it looks again every second
    expect(btn.style.getPropertyValue('--dodge')).toBe('0px')
  })
})
