import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BestallningarPage from './BestallningarPage'
import LayoutEditorPage from '../layout-editor/LayoutEditorPage'
import { KitchenDisplay } from './KitchenDisplay'
import { orderTable } from '../../shared/tables'
import type { Order } from './ordersApi'
import type { StationTicket } from './printApi'

const listOrders = vi.fn()
const listTickets = vi.fn()
const apiFetch = vi.fn()
const getAvailability = vi.fn()

vi.mock('../../shared/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/api')>()),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  isApiConfigured: () => true,
}))
vi.mock('./ordersApi', async (orig) => ({
  ...(await orig<typeof import('./ordersApi')>()),
  listOrders: (...a: unknown[]) => listOrders(...a),
}))
vi.mock('./printApi', async (orig) => ({
  ...(await orig<typeof import('./printApi')>()),
  getPrintStatus: () => Promise.reject(new Error('none')),
  getRouting: () => Promise.resolve({ stations: [{ stationId: 'kok', name: 'Kök', printerIds: [] }], categories: {}, allergyTicket: true, version: 1 }),
  listTickets: (...a: unknown[]) => listTickets(...a),
}))
vi.mock('../bokningar/bookingsApi', async (orig) => ({
  ...(await orig<typeof import('../bokningar/bookingsApi')>()),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
  todayIn: () => '2026-11-17',
}))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1>,
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/location', async (orig) => ({
  ...(await orig<typeof import('../../shared/location')>()),
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({
    tenant: { role: 'staff_user', locations: [{ locationId: 'loc-1', name: 'Sole', timezone: 'Europe/Stockholm' }] },
    locationId: 'loc-1',
    status: 'ready',
  }),
}))

const table = (id: string, x: number) => ({
  elementId: id, type: 'table', x, y: 0, z: 2, width: 1.2, height: 0.75, depth: 0.8, rotationY: 0,
  floorId: 'f1', shape: 'rect', seats: 4,
})
// Bord 1, 2, 3 i ritningens ordning; uuid:na visas aldrig.
const LAYOUT = {
  floors: [{ floorId: 'f1', name: 'Entréplan', level: 0 }],
  elements: [table('uuid-a', 1), table('uuid-b', 3), table('uuid-c', 5)],
}

function order(extra: Partial<Order> = {}): Order {
  return {
    orderId: 'o1', locationId: 'loc-1', number: 7, status: 'confirmed', mode: 'table', tableId: 'uuid-c', tableLabel: '3',
    date: '2026-11-17',
    lines: [{ menuItemId: 'pizza', name: 'Margherita', unitPrice: 12500, quantity: 1, total: 12500, vatRate: 12 }],
    totalAmount: 12500, customerName: 'Anna', confirmedAt: '2026-11-17T16:00:00Z', ...extra,
  }
}

let small = true
beforeEach(async () => {
  const { clearTablesCache } = await import('../../shared/tables')
  clearTablesCache()
  small = true
  window.matchMedia = ((query: string) => ({
    matches: small, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  apiFetch.mockReset().mockResolvedValue(LAYOUT)
  getAvailability.mockReset().mockResolvedValue({ slots: [] })
  listOrders.mockReset()
  listTickets.mockReset()
})
afterEach(() => {
  window.history.replaceState(null, '', '/')
})

function app() {
  return render(
    <MemoryRouter initialEntries={['/bestallningar']}>
      <Routes>
        <Route path="/bestallningar" element={<BestallningarPage />} />
        <Route path="/layout" element={<LayoutEditorPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('orderTable', () => {
  const labels = new Map([['uuid-a', '1'], ['uuid-b', '2'], ['uuid-c', '3']])
  it('uses the table id and the active layout numbering', () => {
    expect(orderTable('uuid-b', '7', labels)).toEqual({ id: 'uuid-b', label: '2' })
  })
  it('a removed table keeps its stored name and has no id', () => {
    expect(orderTable('gone', '9', labels)).toEqual({ id: null, label: '9' })
  })
  it('without an id the table is found by its name', () => {
    expect(orderTable(undefined, '3', labels)).toEqual({ id: 'uuid-c', label: '3' })
  })
  it('without the layout the stored name is shown', () => {
    expect(orderTable('uuid-c', '3', null)).toEqual({ id: null, label: '3' })
  })
})

describe('order table chip', () => {
  it('links to the layout with the table and the service date', async () => {
    listOrders.mockResolvedValue({ date: '2026-11-17', ordering: { open: true }, orders: [order({ tableLabel: 'gammalt' })] })
    app()
    const chip = await screen.findByRole('link', { name: 'Bord 3, visa i bordskartan' })
    expect(chip).toHaveAttribute('href', '/layout?bord=uuid-c&datum=2026-11-17')
    expect(chip).toHaveTextContent('Bord 3')
    expect(screen.queryByText(/uuid/)).toBeNull()
  })

  it('a tap opens the layout with the table highlighted', async () => {
    const user = userEvent.setup()
    listOrders.mockResolvedValue({ date: '2026-11-17', ordering: { open: true }, orders: [order()] })
    app()
    await user.click(await screen.findByRole('link', { name: 'Bord 3, visa i bordskartan' }))
    const target = await screen.findByRole('button', { name: /^Bord 3, 4 pl/ })
    expect(target.getAttribute('class')).toContain('is-focus')
    expect(target).toHaveAttribute('aria-pressed', 'true')
    expect(getAvailability).toHaveBeenLastCalledWith('loc-1', '2026-11-17', { walkIn: false })
  })

  it('pickup stays text and a removed table shows its stored name without a link', async () => {
    listOrders.mockResolvedValue({
      date: '2026-11-17', ordering: { open: true },
      orders: [order({ orderId: 'p', number: 8, mode: 'pickup', tableId: undefined, tableLabel: undefined }),
        order({ orderId: 'g', number: 9, tableId: 'gone', tableLabel: '12' })],
    })
    app()
    const pickup = await screen.findByRole('article', { name: 'Beställning 8, Avhämtning' })
    expect(within(pickup).queryByRole('link')).toBeNull()
    const gone = screen.getByRole('article', { name: 'Beställning 9, Bord 12' })
    expect(within(gone).getByText('Bord 12')).toBeInTheDocument()
    expect(within(gone).queryByRole('link')).toBeNull()
  })

  it('ready and finished orders carry the chip too', async () => {
    listOrders.mockResolvedValue({
      date: '2026-11-17', ordering: { open: true },
      orders: [order({ status: 'ready' }), order({ orderId: 'd', number: 5, status: 'completed', tableId: 'uuid-a', tableLabel: '1' })],
    })
    app()
    await screen.findByText(/Bär till/)
    expect(screen.getAllByRole('link', { name: 'Bord 3, visa i bordskartan' })).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Bord 1, visa i bordskartan' })).toHaveAttribute('href', '/layout?bord=uuid-a&datum=2026-11-17')
  })
})

describe('kitchen display chip', () => {
  const TICKET: StationTicket = {
    sourceId: 'o1', orderId: 'o1', stationId: 'kok', stationName: 'Kök', status: 'sent', allergy: false, number: 7,
    mode: 'table', tableLabel: '3', entries: [{ name: 'Margherita', quantity: 1, course: 'mains' }],
  }

  it('the ticket table opens the layout (id from the order)', async () => {
    listTickets.mockResolvedValue([TICKET])
    render(
      <MemoryRouter>
        <KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}}
          labels={new Map([['uuid-c', '3']])} tableIds={new Map([['o1', 'uuid-c']])} date="2026-11-17" />
      </MemoryRouter>,
    )
    const chip = await screen.findByRole('link', { name: 'Bord 3, visa i bordskartan' })
    expect(chip).toHaveAttribute('href', '/layout?bord=uuid-c&datum=2026-11-17')
  })

  it('pickup tickets have no link', async () => {
    listTickets.mockResolvedValue([{ ...TICKET, mode: 'pickup', tableLabel: undefined }])
    render(
      <MemoryRouter>
        <KitchenDisplay locationId="loc-1" station="kok" onStation={() => {}} labels={new Map([['uuid-c', '3']])} />
      </MemoryRouter>,
    )
    await screen.findByText('Avhämtning')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
