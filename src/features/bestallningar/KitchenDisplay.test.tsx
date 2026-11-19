import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KitchenDisplay } from './KitchenDisplay'
import type { StationTicket } from './printApi'

const listTickets = vi.fn()
const setTicketStatus = vi.fn()
const reprintTicket = vi.fn()
vi.mock('./printApi', async (orig) => ({
  ...(await orig<typeof import('./printApi')>()),
  getRouting: () => Promise.resolve({
    stations: [{ stationId: 'kok', name: 'Kök', printerIds: [] }, { stationId: 'bar', name: 'Bar', printerIds: [] }],
    categories: {}, allergyTicket: true, version: 1,
  }),
  listTickets: (...a: unknown[]) => listTickets(...a),
  setTicketStatus: (...a: unknown[]) => setTicketStatus(...a),
  reprintTicket: (...a: unknown[]) => reprintTicket(...a),
}))

const KITCHEN: StationTicket = {
  sourceId: 'o1', orderId: 'o1', stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: true, number: 12,
  mode: 'table', tableLabel: '7', placedAt: '2026-11-13T17:00:00Z',
  entries: [
    { name: 'Toast Skagen', quantity: 2, course: 'starters' },
    { name: 'Burgare', quantity: 1, course: 'mains', partOf: 'Burgarmeny', note: 'ingen lök', allergy: 'jordnötsallergi' },
  ],
}
const BAR: StationTicket = { ...KITCHEN, stationId: 'bar', stationName: 'Bar', allergy: false,
  entries: [{ name: 'Mojito', quantity: 1, course: 'drinks' }] }

beforeEach(() => {
  listTickets.mockReset().mockResolvedValue([KITCHEN, BAR])
  setTicketStatus.mockReset().mockImplementation((_l, t, status) => Promise.resolve({ ...t, status }))
  reprintTicket.mockReset().mockResolvedValue(undefined)
})

describe('KitchenDisplay', () => {
  it('shows only the station\'s ticket, by course, with the allergy marked', async () => {
    render(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} />)
    const ticket = await screen.findByRole('article', { name: 'Bong #12, Bord 7, skickad' })
    expect(within(ticket).getByText('Förrätt')).toBeInTheDocument()
    expect(within(ticket).getByText('Varmrätt')).toBeInTheDocument()
    expect(within(ticket).getByText('Allergi: jordnötsallergi')).toBeInTheDocument()
    expect(within(ticket).getByRole('note')).toHaveTextContent('Allergi')
    expect(screen.queryByText('Mojito')).toBeNull()
  })

  it('moves a ticket to tillagas and klar, and prints it again', async () => {
    const user = userEvent.setup()
    render(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Påbörja' }))
    expect(setTicketStatus).toHaveBeenCalledWith('loc-1', expect.objectContaining({ stationId: 'kok' }), 'preparing')
    await user.click(screen.getByRole('button', { name: 'Klar' }))
    expect(setTicketStatus).toHaveBeenLastCalledWith('loc-1', expect.objectContaining({ stationId: 'kok' }), 'ready')
    await user.click(screen.getByRole('button', { name: 'Skriv ut' }))
    expect(reprintTicket).toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('skickad till Kök igen')
  })

  it('switches station', async () => {
    const user = userEvent.setup()
    const onStation = vi.fn()
    render(<KitchenDisplay locationId="loc-1" station="kok" onStation={onStation} />)
    await user.click(await screen.findByRole('tab', { name: /Bar/ }))
    expect(onStation).toHaveBeenCalledWith('bar')
  })

  it('shows a table order ticket: round, waiter, SKICKA NU and what is waiting', async () => {
    const TAB: StationTicket = {
      sourceId: `${'b'.repeat(32)}r2`, stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: false,
      kind: 'tab', tabId: 'b'.repeat(32), round: 2, mode: 'table', tableId: 't5', tableLabel: '5', waiter: 'Anna', covers: 4,
      placedAt: '2026-11-19T17:42:00Z', fire: 'mains', waiting: [{ course: 'desserts', quantity: 4 }],
      entries: [{ name: 'Oxfilé', quantity: 4, course: 'mains' }],
    }
    listTickets.mockResolvedValue([KITCHEN, TAB])
    render(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} />)
    const ticket = await screen.findByRole('article', { name: 'Bong Bord 5, runda 2, skickad' })
    expect(within(ticket).getByText('R2')).toBeInTheDocument()
    expect(within(ticket).getByText('Anna · 4 gäster')).toBeInTheDocument()
    expect(within(ticket).getByText('SKICKA NU: VARMRÄTT')).toBeInTheDocument()
    expect(within(ticket).getByText('Väntar: Efterrätt 4')).toBeInTheDocument()
  })

  it('marks a void ticket MAKULERAD and filters by source', async () => {
    const user = userEvent.setup()
    const VOID: StationTicket = {
      sourceId: `${'b'.repeat(32)}r3`, stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: false,
      kind: 'tab_void', tabId: 'b'.repeat(32), round: 3, mode: 'table', tableLabel: '5', notes: 'wrong',
      entries: [{ name: 'Burrata', quantity: 1, course: 'starters' }],
    }
    listTickets.mockResolvedValue([KITCHEN, VOID])
    const onSource = vi.fn()
    const { rerender } = render(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} onSource={onSource} />)
    const ticket = await screen.findByRole('article', { name: 'Bong Bord 5, runda 3, makulerad' })
    expect(within(ticket).getByText('MAKULERAD: Fel registrerad')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bord' }))
    expect(onSource).toHaveBeenCalledWith('bord')
    rerender(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} source="bord" onSource={onSource} />)
    expect(screen.queryByRole('article', { name: /Bong #12/ })).toBeNull()
    expect(screen.getByRole('article', { name: /runda 3/ })).toBeInTheDocument()
    rerender(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} source="avhamtning" onSource={onSource} />)
    expect(screen.queryByRole('article', { name: /runda 3/ })).toBeNull()
  })

  it('shows a FLYTTAD slip as a small note, not a ticket', async () => {
    const MOVE: StationTicket = {
      sourceId: `${'b'.repeat(32)}r4`, stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: false,
      kind: 'tab_move', tabId: 'b'.repeat(32), round: 4, mode: 'table', tableLabel: '7', fromLabel: '5', toLabel: '7',
      placedAt: new Date().toISOString(), entries: [],
    }
    listTickets.mockResolvedValue([MOVE])
    render(<KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} />)
    const slips = await screen.findByRole('list', { name: 'Flyttade bord' })
    expect(slips).toHaveTextContent('FLYTTAD Bord 5 till Bord 7')
    expect(screen.queryByRole('article')).toBeNull()
  })
})
