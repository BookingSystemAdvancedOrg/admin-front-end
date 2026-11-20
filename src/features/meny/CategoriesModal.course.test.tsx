import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CategoriesModal } from './CategoriesModal'
import type { TicketRouting } from '../bestallningar/printApi'
import { chooseOption } from '../../test/select'

const ROUTING: TicketRouting = {
  stations: [{ stationId: 'kok', name: 'Kök', printerIds: [] }, { stationId: 'bar', name: 'Dryck', printerIds: [] }],
  categories: {}, allergyTicket: true, version: 1,
}

describe('CategoriesModal course (Rätt)', () => {
  it('shows the default course and saves the one the owner picks', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <CategoriesModal
        categories={[{ categoryId: 'mains', name: 'Varmrätter' }, { categoryId: 'c1', name: 'Pizzor' }, { categoryId: 'c2', name: 'Öl' }]}
        version={3} dishCounts={{}} onSave={onSave} fetchLatest={vi.fn()} onCancel={() => {}}
        routing={ROUTING} onRoute={vi.fn()} />,
    )
    expect(screen.getByRole('combobox', { name: 'Varmrätter, rätt' })).toHaveTextContent('Varmrätt')
    expect(screen.getByRole('combobox', { name: 'Pizzor, rätt' })).toHaveTextContent('Övrigt')
    expect(screen.getByRole('combobox', { name: 'Öl, rätt' })).toHaveTextContent('Dryck')
    chooseOption(screen.getByRole('combobox', { name: 'Pizzor, rätt' }), 'mains')
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(onSave).toHaveBeenCalledWith([
      { categoryId: 'mains', name: 'Varmrätter' },
      { categoryId: 'c1', name: 'Pizzor', course: 'mains' },
      { categoryId: 'c2', name: 'Öl' },
    ], 3)
  })
})
