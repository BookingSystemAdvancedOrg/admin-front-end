import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { stepsFromServer } from './overview'
import { serverChecklist } from './setupFixture'
import { SetupStepItem } from './SetupStepItem'

const steps = (state = {}, skippedHere: string[] = []) => stepsFromServer(serverChecklist(state, { skippedHere }), 'loc-1')
const one = (id: string, state = {}, skippedHere: string[] = []) => steps(state, skippedHere).find((s) => s.id === id)!

describe('Kom igång: Hoppa över och Ångra', () => {
  it('skips an open step at this location', async () => {
    const onSkip = vi.fn()
    const step = one('menu')
    render(<MemoryRouter><SetupStepItem step={step} askOn={false} onSkip={onSkip} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Hoppa över: Lägg upp menyn' }))
    expect(onSkip).toHaveBeenCalledWith(step, true)
    expect(step.locationId).toBe('loc-1')
  })

  it('a step that could not be checked can still be skipped', async () => {
    const onSkip = vi.fn()
    const step = stepsFromServer(serverChecklist({}, { unknown: ['staff'] }), 'loc-1').find((s) => s.id === 'staff')!
    render(<MemoryRouter><SetupStepItem step={step} askOn={false} onSkip={onSkip} /></MemoryRouter>)
    expect(screen.getByText('Kunde inte kontrolleras')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hoppa över: Bjud in personal' }))
    expect(onSkip).toHaveBeenCalledWith(step, true)
  })

  it('undoes its own skip, and shows it as skipped', async () => {
    const onSkip = vi.fn()
    const step = one('stripe', { stripe: 'skipped' }, ['stripe'])
    render(<MemoryRouter><SetupStepItem step={step} askOn={false} onSkip={onSkip} /></MemoryRouter>)
    expect(screen.getByText('Överhoppat')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ångra överhoppat: Slutför Stripe för kortbetalningar' }))
    expect(onSkip).toHaveBeenCalledWith(step, false)
  })

  it('no skip for the agreement, for done steps, or for the step\'s own skip', () => {
    for (const step of [one('dpa'), one('hours', { hours: 'done' }), one('printers', { printers: 'skipped' })]) {
      const { unmount } = render(<MemoryRouter><SetupStepItem step={step} askOn={false} onSkip={vi.fn()} /></MemoryRouter>)
      expect(screen.queryByRole('button', { name: /Hoppa över|Ångra/ })).toBeNull()
      unmount()
    }
    render(<MemoryRouter><SetupStepItem step={one('printers', { printers: 'skipped' })} askOn={false} /></MemoryRouter>)
    expect(screen.getByText('Inga skrivare än')).toBeInTheDocument()
  })
})
