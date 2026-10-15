import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GuideProvider, hasSeenGuide, useGuide } from './Guide'

// jsdom ritar ingen layout: låt alla mål "synas" så att stegen inte filtreras bort.
const realRects = Element.prototype.getClientRects

function Menu({ withOrdering = true }: { withOrdering?: boolean }) {
  const { start } = useGuide()
  return (
    <nav>
      <a data-tour="nav-oversikt">Översikt</a>
      <a data-tour="nav-bokningar">Bokningar</a>
      {withOrdering && <a data-tour="nav-bestallningar">Beställningar</a>}
      <a data-tour="nav-meny">Meny</a>
      <a data-tour="nav-layout">Layout</a>
      <a data-tour="nav-installningar">Inställningar</a>
      <a data-tour="nav-hjalp">Hjälp</a>
      <button type="button" onClick={start}>Starta guiden</button>
    </nav>
  )
}

beforeEach(() => {
  localStorage.clear()
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList
  }
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  Element.prototype.getClientRects = realRects
  vi.useRealTimers()
})

async function renderGuide(props: { autoStart?: boolean; withOrdering?: boolean } = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(
    <GuideProvider user="sub-1" autoStart={props.autoStart ?? true}>
      <Menu withOrdering={props.withOrdering} />
    </GuideProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

describe('Guide', () => {
  it('starts by itself for a new user and walks through the menu in order', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide()

    expect(screen.getByRole('dialog', { name: 'Välkommen till Booqy Admin' })).toBeInTheDocument()
    expect(screen.getByText('1 av 8')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Visa mig' }))
    expect(screen.getByRole('dialog', { name: 'Översikt' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nästa' }))
    expect(screen.getByRole('dialog', { name: 'Bokningar' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Tillbaka' }))
    expect(screen.getByRole('dialog', { name: 'Översikt' })).toBeInTheDocument()

    for (let i = 0; i < 6; i++) await user.click(screen.getByRole('button', { name: 'Nästa' }))
    expect(screen.getByRole('dialog', { name: 'Hjälp' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Klar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hasSeenGuide('sub-1')).toBe(true)
  })

  it('skips steps for parts the restaurant does not have', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide({ withOrdering: false })
    expect(screen.getByText('1 av 7')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Visa mig' }))
    await user.click(screen.getByRole('button', { name: 'Nästa' }))
    await user.click(screen.getByRole('button', { name: 'Nästa' }))
    expect(screen.getByRole('dialog', { name: 'Meny' })).toBeInTheDocument()
  })

  it('does not come back after "Hoppa över", but can be started again from Hjälp', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide()
    await user.click(screen.getByRole('button', { name: 'Hoppa över' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hasSeenGuide('sub-1')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Starta guiden' }))
    expect(screen.getByRole('dialog', { name: 'Välkommen till Booqy Admin' })).toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderGuide()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays away for a user who has already seen it', async () => {
    localStorage.setItem('booqy-guide-done:sub-1', '1')
    await renderGuide()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not start by itself when autoStart is off', async () => {
    await renderGuide({ autoStart: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
