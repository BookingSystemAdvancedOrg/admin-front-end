import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { chooseOption, optionTexts } from '../../test/select'
import type { Order, TableTab } from './ordersApi'
import { PAY_POLL_MS, TableTabsBoard, dayLabel, staleLabel, visibleTabs } from './TableTabs'

const markPaidOutside = vi.fn()
const writeOff = vi.fn()
const payLink = vi.fn()
const listTabs = vi.fn()
vi.mock('./ordersApi', async (orig) => ({
  ...(await orig<typeof import('./ordersApi')>()),
  markPaidOutside: (...a: unknown[]) => markPaidOutside(...a),
  writeOff: (...a: unknown[]) => writeOff(...a),
  payLink: (...a: unknown[]) => payLink(...a),
  listTabs: (...a: unknown[]) => listTabs(...a),
}))

const order = (id: string, number: number, total: number): Order => ({
  orderId: id.repeat(32), locationId: 'loc-1', number, status: 'preparing', mode: 'table', tableId: 't4', tableLabel: '4',
  paymentStatus: 'unpaid', payLater: true, serviceDate: '2026-11-17', totalAmount: total, createdAt: '2026-11-17T17:05:00Z',
  lines: [{ menuItemId: 'pizza', name: 'Pizza Margherita', unitPrice: total, quantity: 1, total, vatRate: 12 }],
})

const tab = (extra: Partial<TableTab> = {}): TableTab => ({
  tableId: 't4', tableLabel: '4', title: 'Bord 4', serviceDate: '2026-11-17', amount: 45000, count: 2,
  oldestAt: '2026-11-17T17:05:00Z', orders: [order('a', 12, 25000), order('b', 13, 20000)], stale: false, ...extra,
})

function renderBoard(props: Partial<Parameters<typeof TableTabsBoard>[0]> = {}) {
  const onChanged = vi.fn()
  const view = render(
    <TableTabsBoard locationId="loc-1" tabs={[tab()]} today="2026-11-17" canAct isOwner={false} onChanged={onChanged}
      {...props} />,
  )
  return { onChanged, ...view }
}

beforeEach(() => {
  markPaidOutside.mockReset().mockResolvedValue({ tab: tab({ amount: 0, count: 0, orders: [] }), orders: [] })
  writeOff.mockReset().mockResolvedValue({ tab: tab({ amount: 0, count: 0, orders: [] }), orders: [] })
  payLink.mockReset().mockResolvedValue({
    url: 'https://example.se/notan/loc-1#L.abc.def', expiresAt: '2026-11-18T05:00:00Z', amount: 45000, count: 2,
  })
  listTabs.mockReset().mockResolvedValue({ serviceDate: '2026-11-17', tabs: [tab()] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('table bill helpers', () => {
  it('labels an old bill with its day and a bill after closing', () => {
    expect(dayLabel('2026-11-16')).toBe('16 nov')
    expect(staleLabel({ stale: true, serviceDate: '2026-11-16' }, '2026-11-17')).toBe('Från 16 nov')
    expect(staleLabel({ stale: true, serviceDate: '2026-11-17' }, '2026-11-17')).toBe('Efter stängning')
    expect(staleLabel({ stale: false, serviceDate: '2026-11-17' }, '2026-11-17')).toBeNull()
  })

  it('shows open, paying and (to the owner) flagged bills only', () => {
    const empty = tab({ count: 0, amount: 0, orders: [] })
    const paying = tab({ count: 0, amount: 0, orders: [], paying: { billId: 'b1', amount: 45000 } })
    const flagged = tab({ count: 0, amount: 0, orders: [], mismatch: { billId: 'b2', orderIds: ['x'] } })
    expect(visibleTabs([tab(), empty, paying, flagged], false)).toHaveLength(2)
    expect(visibleTabs([tab(), empty, paying, flagged], true)).toHaveLength(3)
  })
})

describe('TableTabsBoard', () => {
  it('shows what the table owes, its orders and the staff actions (no write-off for staff)', async () => {
    const user = userEvent.setup()
    renderBoard()
    const card = screen.getByRole('article', { name: 'Nota Bord 4' })
    expect(within(card).getByText('Att betala')).toBeInTheDocument()
    expect(within(card).getByText('#12')).toBeInTheDocument()
    expect(within(card).getAllByText('250 kr')).toHaveLength(2)
    const first = within(card).getByText('#12').closest('details')!
    expect(first.open).toBe(false)
    await user.click(within(card).getByText('#12'))
    expect(first.open).toBe(true)
    expect(within(first).getByText('1 × Pizza Margherita')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Betala med mobilen' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Markera som betald' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Skriv av' })).toBeNull()
  })

  it('is read only without the Beställningar area', () => {
    renderBoard({ canAct: false })
    expect(screen.queryByRole('button', { name: 'Betala med mobilen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Markera som betald' })).toBeNull()
  })

  it('marks a bill amber with its day and shows a payment in progress', () => {
    renderBoard({ tabs: [tab({ serviceDate: '2026-11-16', stale: true, paying: { billId: 'b1', amount: 45000 } })] })
    const card = screen.getByRole('article', { name: 'Nota Bord 4' })
    expect(card).toHaveClass('is-stale')
    expect(within(card).getByText('Från 16 nov')).toBeInTheDocument()
    expect(within(card).getByText('Betalas nu')).toBeInTheDocument()
  })

  it('marks a bill paid outside Booqy with the chosen method (branded dropdown)', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderBoard()
    await user.click(screen.getByRole('button', { name: 'Markera som betald' }))
    const dialog = screen.getByRole('dialog', { name: 'Markera som betald, Bord 4' })
    expect(within(dialog).getByText('450 kr')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Spara' }))
    expect(within(dialog).getByText('Välj hur gästen betalade.')).toBeInTheDocument()
    expect(markPaidOutside).not.toHaveBeenCalled()
    chooseOption(within(dialog).getByRole('combobox', { name: 'Hur betalade gästen?' }), 'cash')
    await user.type(within(dialog).getByLabelText('Anteckning (valfri)'), 'Delad nota')
    await user.click(within(dialog).getByRole('button', { name: 'Spara' }))
    expect(markPaidOutside).toHaveBeenCalledWith('loc-1', expect.objectContaining({ tableId: 't4' }),
      { method: 'cash', note: 'Delad nota', expectedAmount: 45000 })
    expect(onChanged).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Bord 4: 450 kr betald utanför Booqy (kontant).')
  })

  it('offers the four ways to pay outside Booqy', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Markera som betald' }))
    expect(optionTexts(screen.getByRole('combobox', { name: 'Hur betalade gästen?' })))
      .toEqual(['Välj…', 'Kort i egen terminal', 'Kontant', 'Swish', 'Annat'])
  })

  it('a changed bill says so, reloads the list and keeps the dialog open', async () => {
    const user = userEvent.setup()
    markPaidOutside.mockRejectedValue(new ApiError(409, 'bill_changed', { code: 'bill_changed', fromServer: true }))
    const { onChanged } = renderBoard()
    await user.click(screen.getByRole('button', { name: 'Markera som betald' }))
    const dialog = screen.getByRole('dialog')
    chooseOption(within(dialog).getByRole('combobox'), 'card_terminal')
    await user.click(within(dialog).getByRole('button', { name: 'Spara' }))
    expect(await within(dialog).findByText('Notan har ändrats. Kontrollera beloppet och spara igen.')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('keeps the amount the staff saw when a new order arrives while the dialog is open', async () => {
    const user = userEvent.setup()
    markPaidOutside.mockRejectedValueOnce(new ApiError(409, 'bill_changed', { code: 'bill_changed', fromServer: true }))
    const onChanged = vi.fn()
    const props = { locationId: 'loc-1', today: '2026-11-17', canAct: true, isOwner: false, onChanged }
    const { rerender } = render(<TableTabsBoard {...props} tabs={[tab()]} />)
    await user.click(screen.getByRole('button', { name: 'Markera som betald' }))
    const dialog = screen.getByRole('dialog')
    chooseOption(within(dialog).getByRole('combobox'), 'cash')
    // Listan uppdateras (var tionde sekund): en efterrätt har kommit till bordet.
    const grown = tab({ amount: 53500, count: 3, orders: [order('a', 12, 25000), order('b', 13, 20000), order('c', 14, 8500)] })
    rerender(<TableTabsBoard {...props} tabs={[grown]} />)
    expect(within(dialog).getByText('450 kr')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Spara' }))
    expect(markPaidOutside).toHaveBeenLastCalledWith('loc-1', expect.objectContaining({ amount: 45000 }),
      { method: 'cash', expectedAmount: 45000 })
    // Servern: notan har ändrats. Nu visas den nya notan och personalen sparar igen.
    expect(await within(dialog).findByText('535 kr')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Spara' }))
    expect(markPaidOutside).toHaveBeenLastCalledWith('loc-1', expect.objectContaining({ amount: 53500 }),
      { method: 'cash', expectedAmount: 53500 })
  })

  it('a write-off keeps the amount the owner saw when the list refreshes', async () => {
    const user = userEvent.setup()
    const props = { locationId: 'loc-1', today: '2026-11-17', canAct: true, isOwner: true, onChanged: vi.fn() }
    const { rerender } = render(<TableTabsBoard {...props} tabs={[tab()]} />)
    await user.click(screen.getByRole('button', { name: 'Skriv av' }))
    rerender(<TableTabsBoard {...props} tabs={[tab({ amount: 53500, count: 3 })]} />)
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Varför?'), 'Gästen gick')
    await user.click(within(dialog).getByRole('button', { name: 'Skriv av 450 kr' }))
    expect(writeOff).toHaveBeenCalledWith('loc-1', expect.objectContaining({ amount: 45000 }),
      { reason: 'Gästen gick', expectedAmount: 45000 })
  })

  it('the owner writes a bill off with a reason', async () => {
    const user = userEvent.setup()
    renderBoard({ isOwner: true })
    await user.click(screen.getByRole('button', { name: 'Skriv av' }))
    const dialog = screen.getByRole('dialog', { name: 'Skriv av, Bord 4' })
    await user.click(within(dialog).getByRole('button', { name: 'Skriv av 450 kr' }))
    expect(within(dialog).getByText('Skriv varför notan skrivs av.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Varför?'), 'Gästen gick')
    await user.click(within(dialog).getByRole('button', { name: 'Skriv av 450 kr' }))
    expect(writeOff).toHaveBeenCalledWith('loc-1', expect.objectContaining({ tableId: 't4' }),
      { reason: 'Gästen gick', expectedAmount: 45000 })
  })

  it('Betala med mobilen shows the QR code and the stamp once the bill is paid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onChanged } = renderBoard()
    await user.click(screen.getByRole('button', { name: 'Betala med mobilen' }))
    const dialog = screen.getByRole('dialog', { name: 'Betala med mobilen, Bord 4' })
    expect(await within(dialog).findByRole('img', { name: 'QR-kod för notan, Bord 4' })).toBeInTheDocument()
    expect(within(dialog).getByText('450 kr')).toBeInTheDocument()
    expect(payLink).toHaveBeenCalledTimes(1)
    // En ny beställning kom under tiden: den hamnar på en ny nota, de betalda är borta.
    listTabs.mockResolvedValue({ serviceDate: '2026-11-17', tabs: [tab({ amount: 9000, count: 1, orders: [order('c', 14, 9000)] })] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAY_POLL_MS + 10)
    })
    expect(within(dialog).getByText('Betald')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
    expect(payLink).toHaveBeenCalledTimes(1)
    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a pay link error says who acts', async () => {
    const user = userEvent.setup()
    payLink.mockRejectedValue(new ApiError(409, 'ordering_no_site', { code: 'ordering_no_site', fromServer: true }))
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Betala med mobilen' }))
    expect(await screen.findByText(/ingen webbadress än/)).toBeInTheDocument()
  })
})
