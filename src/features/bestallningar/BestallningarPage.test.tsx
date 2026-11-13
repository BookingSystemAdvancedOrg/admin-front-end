import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BestallningarPage, { POLL_MS } from './BestallningarPage'
import { ApiError } from '../../shared/api'
import type { Order, OrderList } from './ordersApi'

const listOrders = vi.fn()
const moveOrder = vi.fn()
const pauseOrdering = vi.fn()
vi.mock('./ordersApi', async (orig) => ({
  ...(await orig<typeof import('./ordersApi')>()),
  listOrders: (...a: unknown[]) => listOrders(...a),
  moveOrder: (...a: unknown[]) => moveOrder(...a),
  pauseOrdering: (...a: unknown[]) => pauseOrdering(...a),
}))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))

function order(extra: Partial<Order> = {}): Order {
  return {
    orderId: 'a'.repeat(32), locationId: 'loc-1', number: 7, status: 'confirmed', mode: 'pickup',
    lines: [{ menuItemId: 'pizza', name: 'Margherita', unitPrice: 12500, quantity: 2, total: 25000, vatRate: 6 }],
    totalAmount: 28550, customerName: 'Anna', customerPhone: '+46701234567',
    confirmedAt: '2026-10-12T16:00:00Z', readyEstimate: '2026-10-12T16:20:00Z', ...extra,
  }
}

function list(orders: Order[], ordering: OrderList['ordering'] = { open: true, lastOrderAt: '21:45', prepMinutes: 20 }): OrderList {
  return { date: '2026-10-12', ordering, orders }
}

beforeEach(() => {
  listOrders.mockReset()
  moveOrder.mockReset()
  pauseOrdering.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('BestallningarPage', () => {
  it('shows paid orders in their columns', async () => {
    listOrders.mockResolvedValue(list([
      order(),
      order({ orderId: 'b'.repeat(32), number: 8, status: 'preparing', mode: 'table', tableLabel: '5' }),
      order({ orderId: 'c'.repeat(32), number: 9, status: 'completed' }),
    ]))
    render(<BestallningarPage />)
    const nya = await screen.findByRole('region', { name: 'Nya' })
    expect(within(nya).getByText('#7')).toBeInTheDocument()
    expect(within(nya).getByText('Avhämtning')).toBeInTheDocument()
    expect(within(nya).getByText(/2 ×/)).toBeInTheDocument()
    const tillagas = screen.getByRole('region', { name: 'Tillagas' })
    expect(within(tillagas).getByText('Bord 5')).toBeInTheDocument()
    expect(screen.getByText('Avslutade idag (1)')).toBeInTheDocument()
    expect(screen.getByText(/Tar emot beställningar · sista beställning 21:45/)).toBeInTheDocument()
  })

  it('starts a new order with one click (the confirmation SMS) - no ready before that', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue(list([order()]))
    moveOrder.mockResolvedValue(order({ status: 'preparing' }))
    render(<BestallningarPage />)
    const nya = await screen.findByRole('region', { name: 'Nya' })
    expect(within(nya).queryByRole('button', { name: 'Klar - skicka sms' })).toBeNull()
    await user.click(within(nya).getByRole('button', { name: 'Påbörja - skicka sms' }))
    expect(moveOrder).toHaveBeenCalledWith('loc-1', expect.objectContaining({ status: 'confirmed' }), 'preparing')
    const tillagas = screen.getByRole('region', { name: 'Tillagas' })
    expect(within(tillagas).getByRole('button', { name: 'Klar - skicka sms' })).toBeInTheDocument()
  })

  it('marks a pickup order ready (sends the SMS) and moves it', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue(list([order({ status: 'preparing' })]))
    moveOrder.mockResolvedValue(order({ status: 'ready' }))
    render(<BestallningarPage />)
    await user.click(await screen.findByRole('button', { name: 'Klar - skicka sms' }))
    expect(moveOrder).toHaveBeenCalledWith('loc-1', expect.objectContaining({ status: 'preparing' }), 'ready')
    const klara = screen.getByRole('region', { name: 'Klara' })
    expect(within(klara).getByRole('button', { name: 'Hämtad' })).toBeInTheDocument()
  })

  it('cancels only after the refund is confirmed', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue(list([order()]))
    moveOrder.mockResolvedValue(order({ status: 'cancelled' }))
    render(<BestallningarPage />)
    await user.click(await screen.findByRole('button', { name: 'Avbryt' }))
    expect(moveOrder).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Bekräfta: avbryt och återbetala 285,50 kr' }))
    expect(moveOrder).toHaveBeenCalledWith('loc-1', expect.anything(), 'cancelled')
  })

  it('explains a refund Stripe refused and reloads', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue(list([order()]))
    moveOrder.mockRejectedValue(new ApiError(502, 'refund_failed'))
    render(<BestallningarPage />)
    await user.click(await screen.findByRole('button', { name: 'Avbryt' }))
    await user.click(screen.getByRole('button', { name: /Bekräfta/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe kunde inte återbetala')
    // Dagens lista hämtas om; förra veckans dag (med datum) räknas inte.
    expect(listOrders.mock.calls.filter((c) => c.length === 1)).toHaveLength(2)
  })

  it('pauses and resumes ordering', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue(list([]))
    pauseOrdering.mockResolvedValueOnce({ ordering: { open: false, reason: 'paused', pausedUntil: '2026-10-12T16:30:00Z' } })
    pauseOrdering.mockResolvedValueOnce({ ordering: { open: true } })
    render(<BestallningarPage />)
    await user.selectOptions(await screen.findByLabelText('Pausa beställningar'), '30')
    expect(pauseOrdering).toHaveBeenCalledWith('loc-1', 30)
    expect(await screen.findByText(/Pausat till/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ta emot beställningar igen' }))
    expect(pauseOrdering).toHaveBeenLastCalledWith('loc-1', 0)
  })

  it('polls and highlights new orders', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    listOrders.mockResolvedValueOnce(list([]))
    listOrders.mockResolvedValue(list([order()]))
    render(<BestallningarPage />)
    expect(await screen.findByText('Inga nya beställningar.')).toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    const card = await screen.findByRole('article', { name: 'Beställning 7, Avhämtning' })
    expect(card).toHaveClass('fresh')
    expect(screen.getByText('Ny beställning #7, Avhämtning')).toBeInTheDocument()
    expect(document.title).toBe('(1) Beställningar')
  })

  it('says why ordering is closed', async () => {
    listOrders.mockResolvedValue(list([], { open: false, reason: 'no_payments' }))
    render(<BestallningarPage />)
    expect(await screen.findByText(/Stripe-kontot kan inte ta emot betalningar/)).toBeInTheDocument()
  })

  it('tells staff which table to bring a ready order to', async () => {
    const user = userEvent.setup()
    const atTable = order({ status: 'preparing', mode: 'table', tableId: 't-7', tableLabel: '7' })
    listOrders.mockResolvedValue(list([atTable]))
    moveOrder.mockResolvedValue({ ...atTable, status: 'ready' })
    render(<BestallningarPage />)
    const card = await screen.findByRole('article', { name: 'Beställning 7, Bord 7' })
    await user.click(within(card).getByRole('button', { name: 'Klar att servera' }))
    expect(screen.getByText(/är klar\. Bär maten till/)).toBeInTheDocument()
    const klara = screen.getByRole('region', { name: 'Klara' })
    expect(within(klara).getByText('Bär till Bord 7')).toBeInTheDocument()
    expect(within(klara).getByRole('button', { name: 'Serverad vid Bord 7' })).toBeInTheDocument()
  })

  it('filters the board by table', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue(list([
      order(),
      order({ orderId: 'b'.repeat(32), number: 8, mode: 'table', tableId: 't-2', tableLabel: '2' }),
      order({ orderId: 'c'.repeat(32), number: 9, mode: 'table', tableId: 't-9', tableLabel: 'Terrassen', status: 'ready' }),
    ]))
    render(<BestallningarPage />)
    const select = await screen.findByLabelText('Visa')
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(
      ['Alla bord och avhämtning', 'Avhämtning', 'Bord 2', 'Terrassen'])
    await user.selectOptions(select, 'table:t-2')
    expect(screen.getByRole('article', { name: 'Beställning 8, Bord 2' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /Beställning 7/ })).toBeNull()
    expect(screen.queryByRole('article', { name: /Beställning 9/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Visa alla' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })
})
