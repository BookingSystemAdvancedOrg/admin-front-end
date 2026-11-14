import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { CategoriesModal } from './CategoriesModal'

const CATS = [
  { categoryId: 'mains', name: 'Varmrätter' },
  { categoryId: 'drinks', name: 'Dryck' },
]
const stale = () => new ApiError(409, 'Någon annan har ändrat kategorierna.', { code: 'stale_categories' })

describe('CategoriesModal', () => {
  it('lays your rename on top of the latest list and saves again by itself (409 stale_categories)', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValueOnce(undefined)
    // Någon annan döpte om Dryck och lade till Efterrätter under tiden.
    const fetchLatest = vi.fn().mockResolvedValue({
      categories: [...CATS.slice(0, 1), { categoryId: 'drinks', name: 'Drycker' }, { categoryId: 'desserts', name: 'Efterrätter' }],
      version: 4,
    })
    render(<CategoriesModal categories={CATS} version={3} dishCounts={{}} onSave={onSave} fetchLatest={fetchLatest} onCancel={vi.fn()} />)
    const mains = screen.getByLabelText('Kategori 1')
    await user.clear(mains)
    await user.type(mains, 'Huvudrätter')
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave.mock.calls[0][1]).toBe(3)
    expect(onSave.mock.calls[1]).toEqual([
      [
        { categoryId: 'mains', name: 'Huvudrätter' },
        { categoryId: 'drinks', name: 'Drycker' },
        { categoryId: 'desserts', name: 'Efterrätter' },
      ],
      4,
    ])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ladda om/)).not.toBeInTheDocument()
  })

  it('stops on a name changed on both sides: keeps yours and shows theirs under the field', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValueOnce(undefined)
    const fetchLatest = vi.fn().mockResolvedValue({
      categories: [{ categoryId: 'mains', name: 'Huvudrätter' }, CATS[1]],
      version: 4,
    })
    render(<CategoriesModal categories={CATS} version={3} dishCounts={{}} onSave={onSave} fetchLatest={fetchLatest} onCancel={vi.fn()} />)
    const mains = screen.getByLabelText('Kategori 1')
    await user.clear(mains)
    await user.type(mains, 'Varmt')
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent('Välj namn och spara igen.')
    expect(screen.getByText('Huvudrätter', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByLabelText('Kategori 1')).toHaveValue('Varmt')
    // Spara igen: går mot den senaste versionen.
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(onSave.mock.calls[1][1]).toBe(4)
    expect(onSave.mock.calls[1][0][0]).toEqual({ categoryId: 'mains', name: 'Varmt' })
  })

  it('"Använd" takes the other name', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <CategoriesModal categories={CATS} version={3} dishCounts={{}} onSave={vi.fn()} fetchLatest={vi.fn()} onCancel={vi.fn()} />,
    )
    // Listan hämtades om medan dialogen var öppen: Dryck heter nu Drycker.
    rerender(
      <CategoriesModal categories={[CATS[0], { categoryId: 'drinks', name: 'Drycker' }]} version={3} dishCounts={{}}
        onSave={vi.fn()} fetchLatest={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByLabelText('Kategori 2')).toHaveValue('Dryck')
    expect(screen.getByRole('status')).toHaveTextContent('Ändrades nyss på en annan plats: Drycker')
    await user.click(screen.getByRole('button', { name: 'Använd' }))
    expect(screen.getByLabelText('Kategori 2')).toHaveValue('Drycker')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows other save errors as they are', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new ApiError(503, 'Tillfälligt fel.'))
    const fetchLatest = vi.fn()
    render(<CategoriesModal categories={CATS} version={1} dishCounts={{}} onSave={onSave} fetchLatest={fetchLatest} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Spara kategorier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tillfälligt fel.')
    expect(fetchLatest).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Spara kategorier' })).toBeEnabled()
  })
})
