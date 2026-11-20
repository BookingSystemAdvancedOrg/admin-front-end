import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PEAK_HOLD_MS, PeakMoment, PeakSuccess } from './PeakSuccess'

describe('PeakSuccess', () => {
  it('says what happened, as a status', () => {
    render(<PeakSuccess text="Bokningen är sparad" sub="18:30 · 4 pers" />)
    expect(screen.getByRole('status')).toHaveTextContent('Bokningen är sparad18:30 · 4 pers')
  })

  it('can sit inside another status without announcing twice', () => {
    render(<PeakSuccess text="Skickat till Kök" announce={false} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Skickat till Kök')).toBeInTheDocument()
  })
})

describe('PeakMoment', () => {
  afterEach(() => vi.useRealTimers())

  it('goes by itself after a while', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    render(<PeakMoment text="Kom igång är klart" onDone={done} />)
    expect(screen.getByText('Kom igång är klart')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(PEAK_HOLD_MS))
    expect(done).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(150))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('closes on a tap anywhere, quickly', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    render(<PeakMoment text="Kampanjen är på väg" onDone={done} />)
    fireEvent.pointerDown(screen.getByText('Kampanjen är på väg'))
    expect(document.querySelector('.peak-layer.is-leaving')).not.toBeNull()
    act(() => vi.advanceTimersByTime(150))
    expect(done).toHaveBeenCalledTimes(1)
  })
})
