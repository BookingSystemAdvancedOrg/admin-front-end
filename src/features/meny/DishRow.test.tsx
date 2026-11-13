import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DishRow } from './DishRow'
import type { Dish } from './data'
import { shouldOpenRow } from './rowClick'

const dish: Dish = {
  id: 'm1',
  name: 'Toast Skagen',
  description: 'Klassikern',
  category: 'forratter',
  price: 145,
  active: true,
  alcohol: false,
  imageKey: 'menu-images/t/locations/l/menu/a.webp',
  image: 'https://cdn.example/a.webp',
  imageFocus: { x: 20, y: 80 },
  availableFrom: null,
  availableUntil: null,
}

function setup(over: Partial<Parameters<typeof DishRow>[0]> = {}) {
  const props = {
    dish,
    index: 0,
    now: new Date('2026-11-13T12:00:00Z'),
    timeZone: 'Europe/Stockholm',
    canEdit: true,
    busy: false,
    locationId: null,
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    onPreview: vi.fn(),
    ...over,
  }
  render(
    <table>
      <tbody>
        <DishRow {...props} />
      </tbody>
    </table>,
  )
  return { ...props, user: userEvent.setup(), row: screen.getByRole('row') }
}

describe('DishRow', () => {
  it('opens the editor when any plain part of the row is clicked', async () => {
    const { user, row, onOpen } = setup()
    await user.click(within(row).getByText('Toast Skagen'))
    await user.click(within(row).getByText('145 kr'))
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledWith(dish)
  })

  it('opens with Enter on the focused row', async () => {
    const { user, row, onOpen } = setup()
    row.focus()
    expect(row).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('the status switch toggles without opening the editor', async () => {
    const { user, onOpen, onToggle } = setup()
    await user.click(screen.getByRole('switch', { name: 'Toast Skagen aktiv' }))
    expect(onToggle).toHaveBeenCalledWith(dish)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Redigera opens once and Radera only deletes', async () => {
    const { user, onOpen, onDelete } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Redigera' })[0])
    expect(onOpen).toHaveBeenCalledTimes(1)
    await user.click(screen.getAllByRole('button', { name: 'Radera' })[0])
    expect(onDelete).toHaveBeenCalledWith(dish)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('the image opens the preview, not the editor, and is cropped at the focal point', async () => {
    const { user, onOpen, onPreview } = setup()
    const thumb = screen.getByRole('button', { name: 'Visa bilden på Toast Skagen' })
    expect(within(thumb).getByRole('img', { name: 'Toast Skagen' })).toHaveStyle({ objectPosition: '20% 80%' })
    await user.click(thumb)
    expect(onPreview).toHaveBeenCalledWith(dish)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Enter on a button inside the row does not open the editor as well', async () => {
    const { user, onOpen, onToggle } = setup()
    screen.getByRole('switch').focus()
    await user.keyboard('{Enter}')
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('a read-only or busy row does not open', async () => {
    const readOnly = setup({ canEdit: false })
    expect(readOnly.row).not.toHaveAttribute('tabindex')
    await readOnly.user.click(within(readOnly.row).getByText('Toast Skagen'))
    expect(readOnly.onOpen).not.toHaveBeenCalled()
  })
})

describe('shouldOpenRow', () => {
  it('ignores targets outside the row, such as a portal', () => {
    const row = document.createElement('tr')
    const outside = document.createElement('div')
    expect(shouldOpenRow(outside, row)).toBe(false)
    expect(shouldOpenRow(null, row)).toBe(false)
  })
})
