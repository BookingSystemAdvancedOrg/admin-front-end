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

describe('DishModal Skickas till', () => {
  it('follows the category, shows the ticket it lands on and takes one tap to change', async () => {
    const user = userEvent.setup()
    render(
      <DishModal title="Lägg till rätt" initial={null} timeZone="Europe/Stockholm" categories={CATS}
        locationId="loc-1" onSave={vi.fn()} onCancel={vi.fn()} />,
    )
    const group = await screen.findByRole('radiogroup', { name: 'Skickas till' })
    expect(screen.getByRole('radio', { name: /Som varmrätter \(Kök\)/ })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('.ticket-preview')).toHaveTextContent('Kök · Köket')
    await user.click(screen.getByRole('radio', { name: 'Dryck' }))
    expect(screen.getByRole('radio', { name: 'Dryck' })).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelector('.ticket-preview')).toHaveTextContent('Dryck')
    await user.click(screen.getByRole('radio', { name: 'Ingen bong' }))
    expect(document.querySelector('.ticket-preview')).toHaveTextContent('Ingen bong')
    expect(group).toBeInTheDocument()
  })
})

describe('DishModal Spara follows the changes', () => {
  it('is off while nothing changed, on after a change and off again after changing it back', async () => {
    const user = userEvent.setup()
    render(modal(DISH))
    const save = screen.getByRole('button', { name: 'Spara ändringar' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Namn'), ' med smör')
    expect(save).toBeEnabled()
    await user.clear(screen.getByLabelText('Namn'))
    await user.type(screen.getByLabelText('Namn'), 'Torskrygg')
    expect(save).toBeDisabled()
    // En kryssruta räknas också, och ångras den är det orört igen.
    await user.click(screen.getByRole('checkbox', { name: 'Gluten' }))
    expect(save).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: 'Gluten' }))
    expect(save).toBeDisabled()
  })

  it('keeps the changes and says Spara igen when the save fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('nope'))
    render(modal(DISH, onSave))
    await user.clear(screen.getByLabelText('Pris (kr)'))
    await user.type(screen.getByLabelText('Pris (kr)'), '199')
    await user.click(screen.getByRole('button', { name: 'Spara ändringar' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Spara igen' })).toBeEnabled()
    expect(screen.getByLabelText('Pris (kr)')).toHaveValue('199')
  })

  it('a new dish counts as changed once something is filled in, and saves once it is valid', async () => {
    const user = userEvent.setup()
    render(
      <DishModal title="Lägg till rätt" initial={null} timeZone="Europe/Stockholm" categories={CATS}
        onSave={vi.fn()} onCancel={vi.fn()} />,
    )
    const add = screen.getByRole('button', { name: 'Lägg till rätt' })
    expect(add).toBeDisabled()
    await user.type(screen.getByLabelText('Namn'), 'Pannkakor')
    expect(add).toBeDisabled()
    await user.type(screen.getByLabelText('Pris (kr)'), '95')
    expect(add).toBeEnabled()
  })
})
