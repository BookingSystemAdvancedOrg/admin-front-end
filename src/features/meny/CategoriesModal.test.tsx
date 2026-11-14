import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { CategoriesModal } from './CategoriesModal'

const CATS = [{ categoryId: 'mains', name: 'Varmrätter' }]

describe('CategoriesModal', () => {
  it('offers a reload after someone else saved the categories (409 stale_categories)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(
      new ApiError(409, 'Någon annan har ändrat kategorierna.', { code: 'stale_categories' }),
    )
    const onReload = vi.fn().mockResolvedValue(undefined)
    render(<CategoriesModal categories={CATS} dishCounts={{}} onSave={onSave} onReload={onReload} onCancel={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Ladda om kategorierna' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Någon annan har ändrat kategorierna.')
    expect(screen.queryByRole('button', { name: 'Spara kategorier' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ladda om kategorierna' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('shows no reload button for other save errors', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new ApiError(503, 'Tillfälligt fel.'))
    render(<CategoriesModal categories={CATS} dishCounts={{}} onSave={onSave} onReload={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tillfälligt fel.')
    expect(screen.queryByRole('button', { name: 'Ladda om kategorierna' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara kategorier' })).toBeEnabled()
  })
})
