import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MotionScope, resetMotionForTests, useMotionAllowed } from './MotionScope'

function Probe() {
  return <span data-testid="probe">{useMotionAllowed() ? 'moves' : 'still'}</span>
}

function at(path: string) {
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

  it('lets a page move the first time only, per page and marketing tab', () => {
    expect(at('/bokningar')).toBe('moves')
    expect(at('/bokningar')).toBe('still')
    expect(at('/meny')).toBe('moves')
    expect(at('/marknadsforing')).toBe('moves')
    expect(at('/marknadsforing?flik=kampanjer')).toBe('moves')
    expect(at('/marknadsforing?flik=kampanjer')).toBe('still')
  })
})
