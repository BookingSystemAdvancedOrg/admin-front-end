import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DishModal } from './DishModal'
import type { Dish } from './data'

const CATS = [{ categoryId: 'mains', name: 'Varmrätter' }, { categoryId: 'desserts', name: 'Efterrätter' }]
const DISH: Dish = {
  id: 'd1', name: 'Torskrygg', description: 'Brynt smör', category: 'mains', price: 189, active: true, alcohol: false,
  imageKey: '', image: null, imageFocus: null, availableFrom: null, availableUntil: null, updatedAt: '2026-11-14T10:00:00Z',
}

function modal(latest: Dish | null, onSave = vi.fn().mockResolvedValue(undefined)) {
  return (
    <DishModal title="Redigera rätt" initial={DISH} latest={latest} timeZone="Europe/Stockholm" categories={CATS}
      onSave={onSave} onCancel={vi.fn()} />
  )
}

describe('DishModal while the dish changes somewhere else', () => {
  it('keeps what you typed and shows the other value on the field', async () => {
    const user = userEvent.setup()
    const { rerender } = render(modal(DISH))
    await user.clear(screen.getByLabelText('Pris (kr)'))
    await user.type(screen.getByLabelText('Pris (kr)'), '199')
    // Listan hämtades om: en kollega satte 129 kr på en annan plats.
    rerender(modal({ ...DISH, price: 129, updatedAt: '2026-11-14T10:05:00Z' }))
    expect(screen.getByLabelText('Pris (kr)')).toHaveValue('199')
    expect(screen.getByRole('status')).toHaveTextContent('Ändrades nyss på en annan plats: 129 kr')
    expect(screen.queryByText(/Ladda om/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Använd' }))
    expect(screen.getByLabelText('Pris (kr)')).toHaveValue('129')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows nothing when the change there is the same as yours', async () => {
    const user = userEvent.setup()
    const { rerender } = render(modal(DISH))
    await user.clear(screen.getByLabelText('Namn'))
    await user.type(screen.getByLabelText('Namn'), 'Torsk')
    rerender(modal({ ...DISH, name: 'Torsk' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('DishModal closing by mistake', () => {
  function open(onCancel = vi.fn()) {
    render(
      <DishModal title="Redigera rätt" initial={DISH} latest={DISH} timeZone="Europe/Stockholm" categories={CATS}
        onSave={vi.fn()} onCancel={onCancel} />,
    )
    return onCancel
  }

  it('closes at once on Escape when nothing changed', async () => {
    const user = userEvent.setup()
    const onCancel = open()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('asks before throwing away edits on Escape or a tap outside', async () => {
    const user = userEvent.setup()
    const onCancel = open()
    await user.type(screen.getByLabelText('Pris (kr)'), '0')
    await user.keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Fortsätt redigera' }))
    expect(screen.getByLabelText('Pris (kr)')).toHaveValue('1890')

    const overlay = document.querySelector('.modal-overlay') as HTMLElement
    fireEvent.pointerDown(overlay)
    expect(onCancel).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Släng' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
