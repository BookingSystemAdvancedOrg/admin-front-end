import { fireEvent, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionScope, REVEAL_WINDOW_MS, claimReveal, motionThisLogin, resetMotion, resetMotionForTests, sidebarShouldPour, useMotionAllowed } from './MotionScope'

function Probe() {
  return <span data-testid="probe">{useMotionAllowed() ? 'moves' : 'still'}</span>
}

/** Mounts the shell at `path`, as after a login or a reload. */
function session(path: string) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<MotionScope><Probe /></MotionScope>} />
      </Routes>
    </MemoryRouter>,
  )
  const text = view.getByTestId('probe').textContent
  view.unmount()
  return text
}

describe('MotionScope', () => {
  beforeEach(resetMotionForTests)
  afterEach(() => vi.restoreAllMocks())

  it('moves on the first page after login, then never again until the next login', () => {
    expect(session('/bokningar')).toBe('moves')
    expect(localStorage.getItem('booqy-motion-seen')).toBe('1')
    // A reload, a new tab, another page: all still.
    resetMotionForTests()
    localStorage.setItem('booqy-motion-seen', '1')
    expect(session('/bokningar')).toBe('still')
    expect(session('/meny')).toBe('still')
    // Logging out forgets it; the next login moves again.
    resetMotion()
    expect(session('/meny')).toBe('moves')
  })

  it('stops as soon as the user leaves the first page, even coming back to it', () => {
    function Go({ to }: { to: string }) {
      const navigate = useNavigate()
      return <button onClick={() => navigate(to)}>{to}</button>
    }
    const view = render(
      <MemoryRouter initialEntries={['/bokningar']}>
        <Routes>
          <Route path="*" element={<MotionScope><Probe /><Go to="/meny" /><Go to="/bokningar" /></MotionScope>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(view.getByTestId('probe').textContent).toBe('moves')
    fireEvent.click(view.getByText('/meny'))
    expect(view.getByTestId('probe').textContent).toBe('still')
    fireEvent.click(view.getByText('/bokningar'))
    expect(view.getByTestId('probe').textContent).toBe('still')
    view.unmount()
  })

  it('gives the sidebar and the page the same answer', () => {
    expect(sidebarShouldPour()).toBe(true)
    expect(motionThisLogin()).toBe(true)
    resetMotionForTests()
    localStorage.setItem('booqy-motion-seen', '1')
    expect(sidebarShouldPour()).toBe(false)
    expect(motionThisLogin()).toBe(false)
  })

  it('does not hand motion to another page when the shell remounts', () => {
    expect(session('/bokningar')).toBe('moves')
    // Same page load, the layout remounts on a different page: still.
    expect(session('/meny')).toBe('still')
    expect(session('/bokningar')).toBe('still')
  })

  it('lets tiles and numbers join the reveal only inside its window', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(claimReveal()).toBe(true)
    now += REVEAL_WINDOW_MS - 1
    expect(claimReveal()).toBe(true)
    now += 2
    // A refetch or a remount later on the same page: no replay.
    expect(claimReveal()).toBe(false)
    resetMotion()
    expect(claimReveal()).toBe(true)
  })
})
