import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CloseTabDialog } from './CloseTabDialog'
import type { Tab, TabItem } from '../table-order/types'

function item(extra: Partial<TabItem>): TabItem {
  return {
    itemId: 'i1', menuItemId: 'm1', name: 'Toast Skagen', unitPrice: 14500, quantity: 2, options: [], course: 'starters',
    stationId: 'kok', stationName: 'Kök', state: 'sent', round: 1, addedAt: '2026-11-19T18:00:00Z', addedByName: 'Anna', ...extra,
  }
}

function tab(items: TabItem[]): Tab {
  return {
    tabId: 'a'.repeat(32), status: 'open', tableId: 't5', tableLabel: '5', covers: 2, guestName: 'Erik Lind', reservationId: null,
    items, rounds: [], referenceTotal: items.filter((i) => i.state !== 'void').reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    openedAt: '2026-11-19T18:00:00Z', openedByName: 'Anna', version: 2, updatedAt: '2026-11-19T18:00:00Z',
  }
}

describe('CloseTabDialog', () => {
  it('lists what to key into the POS and closes as paid in the restaurant\'s own system', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<CloseTabDialog tab={tab([item({}), item({ itemId: 'v', name: 'Burrata', state: 'void' })])}
      onCancel={() => {}} onConfirm={onConfirm} onSendFirst={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Stäng Bord 5' })
    const list = within(dialog).getByRole('region', { name: 'Att slå in' })
    expect(within(list).getByText('Toast Skagen')).toBeInTheDocument()
    expect(within(list).getAllByText('290 kr').length).toBeGreaterThan(0)
    expect(within(list).queryByText('Burrata')).toBeNull()
    expect(dialog).not.toHaveTextContent(/kvitto/i)
    await user.click(within(dialog).getByRole('button', { name: 'Betald i kassan, stäng' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('warns about held courses: send first or close anyway', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onSendFirst = vi.fn().mockResolvedValue(undefined)
    render(<CloseTabDialog tab={tab([item({}), item({ itemId: 'h', name: 'Oxfilé', course: 'mains', state: 'held', round: undefined })])}
      onCancel={() => {}} onConfirm={onConfirm} onSendFirst={onSendFirst} />)
    expect(screen.getByRole('note')).toHaveTextContent('Varmrätt 2 har inte skickats.')
    await user.click(screen.getByRole('button', { name: 'Skicka först' }))
    expect(onSendFirst).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Stäng ändå' }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('closes an order with nothing on it without a list', () => {
    render(<CloseTabDialog tab={tab([item({ state: 'void' })])} onCancel={() => {}} onConfirm={vi.fn()} onSendFirst={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'Att slå in' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stäng utan beställning' })).toBeInTheDocument()
  })
})
