import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DishTile } from './DishTile'
import type { TabMenuItem } from './types'

const dish: TabMenuItem = {
  menuItemId: 'm1',
  name: 'Toast Skagen',
  description: '',
  price: 14500,
  categoryId: 'c1',
  alcohol: false,
  allergens: [],
  options: [],
  imageKey: null,
  course: 'starters',
  stationId: null,
  stationName: 'Kök',
}

function Harness() {
  const [count, setCount] = useState(0)
  return (
    <>
      <DishTile item={dish} count={count} station={undefined}
        onAdd={() => setCount((c) => c + 1)} onRemoveOne={() => setCount((c) => c - 1)} onEdit={() => {}} />
      <p data-testid="total">{count}</p>
    </>
  )
}

const tile = () => screen.getByRole('button', { name: /^Toast Skagen, / })
const total = () => screen.getByTestId('total').textContent

describe('DishTile', () => {
  it('has no stepper before the first tap; the first tap chooses one', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByRole('group', { name: 'Toast Skagen, antal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ta bort en' })).toBeNull()
    expect(tile()).toHaveAttribute('aria-pressed', 'false')
    await user.click(tile())
    expect(total()).toBe('1')
    expect(tile()).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('group', { name: 'Toast Skagen, antal' })).getByRole('status')).toHaveTextContent('1 st')
  })

  it('tapping a chosen tile adds nothing; plus and minus change the amount', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(tile())
    await user.click(tile())
    expect(total()).toBe('1')
    const stepper = screen.getByRole('group', { name: 'Toast Skagen, antal' })
    await user.click(within(stepper).getByRole('button', { name: 'Lägg till en' }))
    await user.click(within(stepper).getByRole('button', { name: 'Lägg till en' }))
    expect(total()).toBe('3')
    expect(within(stepper).getByRole('status')).toHaveTextContent('3 st')
    await user.click(within(stepper).getByRole('button', { name: 'Ta bort en' }))
    expect(total()).toBe('2')
  })

  it('minus at one takes the dish out and the tile is unchosen again, focus on the tile', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(tile())
    await user.click(screen.getByRole('button', { name: 'Ta bort en' }))
    expect(total()).toBe('0')
    expect(screen.queryByRole('group', { name: 'Toast Skagen, antal' })).toBeNull()
    expect(tile()).toHaveAttribute('aria-pressed', 'false')
    expect(tile()).toHaveFocus()
  })

  it('works from the keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    tile().focus()
    await user.keyboard('{Enter}')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Ta bort en' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Lägg till en' })).toHaveFocus()
    await user.keyboard(' ')
    expect(total()).toBe('2')
  })
})
