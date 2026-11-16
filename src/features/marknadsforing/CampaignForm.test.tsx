import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CampaignForm } from './CampaignsTab'
import type { Template } from './marketingApi'

vi.mock('./marketingApi', async (orig) => ({
  ...(await orig<typeof import('./marketingApi')>()),
  audienceSize: vi.fn().mockResolvedValue(12),
}))
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant: { locations: [] }, locationId: 'loc-1' }) }))

const TEMPLATES = [{ templateId: 't1', name: 'Nyhetsbrev', subject: 'Hej' }] as Template[]

function setup() {
  const onClose = vi.fn()
  render(<CampaignForm campaign={null} templates={TEMPLATES} onSaved={vi.fn()} onClose={onClose} />)
  const overlay = document.querySelector('.modal-overlay') as HTMLElement
  return { onClose, overlay }
}

describe('CampaignForm closing', () => {
  it('closes at once on a tap outside when nothing changed', async () => {
    const { onClose, overlay } = setup()
    fireEvent.pointerDown(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Släng ändringarna?')).not.toBeInTheDocument()
    await screen.findByText('12 mottagare just nu')
  })

  it('asks before a tap outside or Escape throws away edits', async () => {
    const user = userEvent.setup()
    const { onClose, overlay } = setup()
    await user.type(screen.getByLabelText(/^Namn/), 'Vårmeny')
    fireEvent.pointerDown(overlay)
    expect(await screen.findByText('Släng ändringarna?')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Släng ändringarna?')).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: 'Släng' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
