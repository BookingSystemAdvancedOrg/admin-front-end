import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BusyBar } from './BusyBar'
import { busyEnd, busyStart, resetBusyForTests, withBusy } from './busy'

describe('BusyBar', () => {
  beforeEach(() => {
    resetBusyForTests()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('shows while any write is in flight and reports done afterwards', async () => {
    render(<BusyBar />)
    const bar = () => document.querySelector('.busy-bar') as HTMLElement
    expect(bar().className).toContain('busy-bar--idle')
    act(() => busyStart())
    act(() => busyStart())
    expect(bar().className).toContain('busy-bar--busy')
    expect(screen.getByRole('status')).toHaveTextContent('Sparar…')
    expect(document.documentElement.classList.contains('is-saving')).toBe(true)
    act(() => busyEnd())
    expect(bar().className).toContain('busy-bar--busy') // one still running
    act(() => busyEnd())
    expect(bar().className).toContain('busy-bar--done')
    expect(screen.getByRole('status')).toHaveTextContent('Sparat')
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(bar().className).toContain('busy-bar--idle')
    expect(document.documentElement.classList.contains('is-saving')).toBe(false)
  })

  it('withBusy wraps a promise, also when it fails', async () => {
    render(<BusyBar />)
    const bar = () => document.querySelector('.busy-bar') as HTMLElement
    let release: () => void = () => {}
    const p = withBusy(() => new Promise<void>((_, reject) => { release = () => reject(new Error('x')) }))
    await act(async () => {})
    expect(bar().className).toContain('busy-bar--busy')
    await act(async () => {
      release()
      await p.catch(() => undefined)
    })
    expect(bar().className).toContain('busy-bar--done')
  })
})
