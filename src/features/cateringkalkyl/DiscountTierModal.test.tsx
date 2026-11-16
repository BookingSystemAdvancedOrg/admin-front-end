import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DiscountTierModal } from './DiscountTierModal'
import type { DiscountTier } from './data'

const TIER: DiscountTier = { id: 't1', name: 'Nivå 1', fromPortions: 10, toPortions: 19, discountPercent: 5, active: true }

function setup() {
  const onCancel = vi.fn()
  render(
    <DiscountTierModal title="Redigera rabattnivå" initial={TIER} otherTiers={[]}
      onSave={vi.fn().mockResolvedValue(null)} onCancel={onCancel} />,
  )
  const overlay = document.querySelector('.modal-overlay') as HTMLElement
  return { onCancel, overlay }
}

describe('DiscountTierModal closing', () => {
  it('closes at once on a tap outside or Escape when nothing changed', async () => {
    const { onCancel, overlay } = setup()
    fireEvent.pointerDown(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)
    await userEvent.setup().keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Släng ändringarna?')).not.toBeInTheDocument()
  })

  it('asks before throwing away edits; Escape then only closes the question', async () => {
    const user = userEvent.setup()
    const { onCancel, overlay } = setup()
    await user.clear(screen.getByLabelText('Rabatt (%)'))
    await user.type(screen.getByLabelText('Rabatt (%)'), '8')
    fireEvent.pointerDown(overlay)
    expect(await screen.findByText('Släng ändringarna?')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Släng ändringarna?')).not.toBeInTheDocument())
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Rabatt (%)')).toHaveValue('8')
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: 'Släng' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
