import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TableRulesCard } from './TableRulesCard'
import type { TableInfo } from '../../shared/tables'

const getLocation = vi.fn()
const updateLocation = vi.fn()
vi.mock('./locationApi', async (orig) => ({
  ...(await orig<typeof import('./locationApi')>()),
  getLocation: (...a: unknown[]) => getLocation(...a),
  updateLocation: (...a: unknown[]) => updateLocation(...a),
}))

let tables: TableInfo[] | null = null
vi.mock('../../shared/tables', async (orig) => ({
  ...(await orig<typeof import('../../shared/tables')>()),
  useTables: () => ({
    tables,
    labels: tables ? new Map(tables.map((t) => [t.tableId, t.label])) : null,
    error: false,
  }),
}))

beforeEach(() => {
  getLocation.mockReset()
  updateLocation.mockReset()
  tables = [
    { tableId: 'id-a', label: '1', seats: 2 },
    { tableId: 'id-b', label: '2', seats: 4 },
    { tableId: 'id-c', label: '3', seats: 4 },
    { tableId: 'id-d', label: '4', seats: 10 },
  ]
  updateLocation.mockImplementation(async (_id, body) => ({ locationId: 'loc-1', ...body }))
})

function row(label: string) {
  return screen.getByRole('cell', { name: `Bord ${label}` }).closest('tr') as HTMLElement
}

describe('TableRulesCard', () => {
  it('shows each table with its default online range: half the seats up to all', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<TableRulesCard locationId="loc-1" isOwner />)
    await screen.findByRole('cell', { name: 'Bord 4' })
    expect(within(row('4')).getByLabelText('Bord 4 från antal personer')).toHaveValue('5')
    expect(within(row('4')).getByLabelText('Bord 4 till antal personer')).toHaveValue('10')
    expect(within(row('1')).getByLabelText('Bord 1 från antal personer')).toHaveValue('1')
    expect(screen.queryByText(/Ej sparat/)).toBeNull()
  })

  it('saves only the tables that differ from the default, by id', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<TableRulesCard locationId="loc-1" isOwner />)
    await screen.findByRole('cell', { name: 'Bord 4' })

    await user.click(screen.getByLabelText('Bord 1 bokas online'))
    await user.clear(screen.getByLabelText('Bord 4 från antal personer'))
    await user.type(screen.getByLabelText('Bord 4 från antal personer'), '7')
    expect(screen.getByText('Ej sparat - klicka Spara bordsregler.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara bordsregler' }))

    expect(updateLocation).toHaveBeenCalledWith('loc-1', {
      tableRules: {
        'id-a': { minParty: 1, maxParty: 2, online: false },
        'id-d': { minParty: 7, maxParty: 10, online: true },
      },
      tableCombinations: null,
    })
    expect(await screen.findByText('Sparat. Gäller bokningssidan direkt.')).toBeInTheDocument()
  })

  it('refuses a range larger than the table', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<TableRulesCard locationId="loc-1" isOwner />)
    await screen.findByRole('cell', { name: 'Bord 2' })
    await user.clear(screen.getByLabelText('Bord 2 till antal personer'))
    await user.type(screen.getByLabelText('Bord 2 till antal personer'), '6')
    await user.click(screen.getByRole('button', { name: 'Spara bordsregler' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Bord 2: högst 4 personer')
    expect(updateLocation).not.toHaveBeenCalled()
  })

  it('adds a combination guests may book together', async () => {
    const user = userEvent.setup()
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<TableRulesCard locationId="loc-1" isOwner />)
    await screen.findByRole('cell', { name: 'Bord 3' })
    const add = screen.getByRole('group', { name: 'Ny kombination' })

    await user.click(within(add).getByLabelText(/Bord 2/))
    await user.click(within(add).getByLabelText(/Bord 3/))
    await user.type(screen.getByLabelText('Från (pers)'), '5')
    await user.type(screen.getByLabelText('Till (pers)'), '9')
    await user.click(screen.getByRole('button', { name: 'Lägg till kombination' }))
    expect(screen.getByRole('alert')).toHaveTextContent('8 platser')

    await user.clear(screen.getByLabelText('Till (pers)'))
    await user.type(screen.getByLabelText('Till (pers)'), '8')
    await user.click(screen.getByRole('button', { name: 'Lägg till kombination' }))
    expect(screen.getByText('Bord 2 + 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Spara bordsregler' }))

    expect(updateLocation).toHaveBeenCalledWith('loc-1', {
      tableRules: null,
      tableCombinations: [{ tableIds: ['id-b', 'id-c'], minParty: 5, maxParty: 8 }],
    })
  })

  it('shows saved rules and flags a combination with a removed table', async () => {
    getLocation.mockResolvedValue({
      locationId: 'loc-1',
      tableRules: { 'id-d': { minParty: 8, maxParty: 10, online: true } },
      tableCombinations: [{ tableIds: ['id-b', 'gone'], minParty: 5, maxParty: 8 }],
    })
    render(<TableRulesCard locationId="loc-1" isOwner />)
    await screen.findByRole('cell', { name: 'Bord 4' })
    expect(screen.getByLabelText('Bord 4 från antal personer')).toHaveValue('8')
    expect(screen.getByText(/finns inte i planritningen/)).toBeInTheDocument()
  })

  it('asks for a published floor plan first', async () => {
    tables = []
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<TableRulesCard locationId="loc-1" isOwner />)
    expect(await screen.findByText(/Publicera en planritning/)).toBeInTheDocument()
  })

  it('staff can look but not change', async () => {
    getLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<TableRulesCard locationId="loc-1" isOwner={false} />)
    await screen.findByRole('cell', { name: 'Bord 4' })
    expect(screen.getByLabelText('Bord 1 bokas online')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara bordsregler' })).toBeNull()
  })
})
