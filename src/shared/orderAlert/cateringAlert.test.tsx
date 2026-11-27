import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, OrderList } from '../../features/bestallningar/ordersApi'
import type { RequestSummary } from '../../features/catering/cateringApi'

const listOrders = vi.fn()
const listRequests = vi.fn()
const playOrderAlert = vi.fn()
let tenant: Record<string, unknown> = {}
let status = 'ready'

vi.mock('./alertSound', () => ({
  playOrderAlert: () => playOrderAlert(),
  unlockOrderAudio: () => {},
  onOrderAudioUnlocked: () => () => {},
}))
vi.mock('../tenant', async (orig) => ({
  ...(await orig<typeof import('../tenant')>()),
  useTenant: () => ({ tenant, locationId: 'loc-1', status }),
}))
vi.mock('../../features/bestallningar/ordersApi', async (orig) => ({
  ...(await orig<typeof import('../../features/bestallningar/ordersApi')>()),
  listOrders: (...a: unknown[]) => listOrders(...a),
}))
vi.mock('../../features/catering/cateringApi', async (orig) => ({
  ...(await orig<typeof import('../../features/catering/cateringApi')>()),
  listRequests: (...a: unknown[]) => listRequests(...a),
}))

const { OrderAlert, OrderAlertDialog } = await import('./OrderAlert')
const { CATERING_POLL_MS, ALERT_POLL_MS } = await import('./watch')
const { feedCatering, feedOrders, resetOrderAlerts } = await import('./store')

const req = (n: number, extra: Partial<RequestSummary> = {}): RequestSummary => ({
  requestId: `req-${n}`, status: 'requested', customerType: n === 2 ? 'company' : 'private', customerName: `Gäst ${n}`,
  companyName: n === 2 ? 'Berg & Co' : undefined, deliveryDate: '2026-12-12', deliveryTime: '17:00', fulfilment: n === 3 ? 'pickup' : 'delivery',
  guests: 20 + n, createdAt: `2026-11-21T10:${String(10 + n).padStart(2, '0')}:00Z`, ...extra,
})
const order = (n: number): Order => ({
  orderId: `order-${n}`, locationId: 'loc-1', number: n, status: 'confirmed', mode: 'pickup', lines: [], totalAmount: 35500,
  customerName: `Kund ${n}`, confirmedAt: `2026-11-21T10:${String(30 + n).padStart(2, '0')}:00Z`,
})
const olist = (orders: Order[]): OrderList => ({ date: '2026-11-21', ordering: { open: true }, orders })

beforeEach(() => {
  localStorage.clear()
  resetOrderAlerts()
  listOrders.mockReset()
  listRequests.mockReset()
  playOrderAlert.mockReset()
  playOrderAlert.mockResolvedValue('played')
  listOrders.mockResolvedValue(olist([]))
  tenant = { role: 'owner_user', entitlements: { features: { catering: true } } }
  status = 'ready'
})
afterEach(() => {
  vi.useRealTimers()
  resetOrderAlerts()
})

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
function shell(path = '/meny') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OrderAlert guardMs={0} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}
async function tick(ms = CATERING_POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('catering alert in the shell', () => {
  it('no box on the first list; a box, sound and announcement for a new request; never twice', async () => {
    vi.useFakeTimers()
    listRequests.mockResolvedValue([req(1)])
    shell()
    await tick(0)
    expect(listRequests).toHaveBeenCalledWith('loc-1', 'requested')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(playOrderAlert).not.toHaveBeenCalled()

    listRequests.mockResolvedValue([req(2), req(1)])
    await tick()
    const dialog = screen.getByRole('alertdialog', { name: 'Ny cateringförfrågan' })
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    const slip = within(dialog).getByRole('button', { name: /^Öppna cateringförfrågan Berg & Co, Gäst 2, .*22 gäster, Leverans/ })
    expect(slip).toHaveTextContent('Berg & Co')
    expect(slip).toHaveTextContent('Catering')
    expect(within(dialog).getByText(/^Senaste|Berg & Co, Gäst 2/, { selector: '.sr-only' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    await tick()
    await tick()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(playOrderAlert).toHaveBeenCalledTimes(1)

    listRequests.mockResolvedValue([req(3), req(2), req(1)])
    await tick()
    expect(screen.getByRole('alertdialog', { name: 'Ny cateringförfrågan' })).toBeInTheDocument()
    expect(playOrderAlert).toHaveBeenCalledTimes(2)
  })

  it('a row opens that request page and closes the box', async () => {
    vi.useFakeTimers()
    listRequests.mockResolvedValue([])
    shell('/meny')
    await tick(0)
    listRequests.mockResolvedValue([req(1)])
    await tick()
    fireEvent.click(screen.getByRole('button', { name: /^Öppna cateringförfrågan/ }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/catering/loc-1/req-1')
  })

  it('stays quiet when the plan has no catering, or the person lacks the area', async () => {
    vi.useFakeTimers()
    tenant = { role: 'owner_user', entitlements: { features: { ordering: true } } }
    shell()
    await tick(0)
    await tick()
    expect(listRequests).not.toHaveBeenCalled()
    tenant = { role: 'staff_user', access: { areas: ['bokningar'] }, entitlements: { features: { catering: true } } }
    shell()
    await tick(0)
    await tick()
    expect(listRequests).not.toHaveBeenCalled()
  })

  it('does not fetch while Catering feeds the list itself', async () => {
    vi.useFakeTimers()
    listRequests.mockResolvedValue([])
    shell('/catering')
    await tick(0)
    expect(listRequests).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 4; i++) {
      feedCatering('loc-1', [], 'page')
      await tick(15_000)
    }
    expect(listRequests).toHaveBeenCalledTimes(1)
  })

  it('brings an open box back after a reload without sound, and does not ping the request again', async () => {
    vi.useFakeTimers()
    const raw = JSON.stringify({ v: 1, loc: 'loc-1', seen: ['req-1', 'req-2'], open: ['req-2'], at: Date.now() })
    resetOrderAlerts()
    sessionStorage.setItem('booqy-catering-alert', raw)
    listRequests.mockResolvedValue([req(2), req(1)])
    shell()
    await tick(0)
    expect(screen.getByRole('alertdialog', { name: 'Ny cateringförfrågan' })).toBeInTheDocument()
    expect(playOrderAlert).not.toHaveBeenCalled()
  })
})

describe('orders and catering together', () => {
  beforeEach(() => {
    tenant = { role: 'owner_user', entitlements: { features: { ordering: true, catering: true } } }
  })

  it('one box, one sound, newest first, a title for both, each row opens its page', async () => {
    vi.useFakeTimers()
    listRequests.mockResolvedValue([])
    shell('/meny')
    await tick(0)
    await act(async () => {
      feedOrders('loc-1', [order(1)])
      feedCatering('loc-1', [req(1)])
    })
    expect(screen.getByRole('alertdialog', { name: 'Nya ärenden 2' })).toBeInTheDocument()
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Kund 1')
    expect(rows[1]).toHaveTextContent('Gäst 1')
    expect(screen.getByRole('list', { name: 'Beställningar och cateringförfrågningar, nyaste först' })).toBeInTheDocument()
    // En rad till medan rutan står: den läses upp.
    await act(async () => {
      feedCatering('loc-1', [req(2), req(1)])
    })
    expect(document.querySelector('[aria-live="assertive"]')).toHaveTextContent(/^Ny cateringförfrågan Berg & Co, Gäst 2/)
    fireEvent.click(screen.getByRole('button', { name: /^Öppna cateringförfrågan Gäst 1/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/catering/loc-1/req-1')
  })

  it('staff with only Beställningar get orders but no catering', async () => {
    vi.useFakeTimers()
    tenant = { role: 'staff_user', access: { areas: ['bestallningar'] }, entitlements: { features: { ordering: true, catering: true } } }
    listOrders.mockResolvedValue(olist([]))
    shell()
    await tick(0)
    await tick(ALERT_POLL_MS)
    expect(listRequests).not.toHaveBeenCalled()
    expect(listOrders).toHaveBeenCalled()
  })
})

describe('OrderAlertDialog with requests', () => {
  const props = { muted: false, rev: 1, latest: [] as string[], onOk: vi.fn(), onOpen: vi.fn(), guardMs: 0 }
  it('several requests: plural title and count; opens a request', () => {
    const onOpenRequest = vi.fn()
    render(<OrderAlertDialog {...props} orders={[]} requests={[req(2), req(1)]} onOpenRequest={onOpenRequest} />)
    expect(screen.getByRole('alertdialog', { name: 'Nya cateringförfrågningar 2' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Gäst 1/ }))
    expect(onOpenRequest).toHaveBeenCalledWith('req-1')
  })
})

describe('opening one row keeps the other kind', () => {
  beforeEach(() => {
    tenant = { role: 'owner_user', entitlements: { features: { ordering: true, catering: true } } }
  })

  async function mixedBox(path = '/meny') {
    vi.useFakeTimers()
    listRequests.mockResolvedValue([])
    shell(path)
    await tick(0)
    await act(async () => {
      feedOrders('loc-1', [order(1)])
      feedCatering('loc-1', [req(1)])
    })
  }

  it('opening a request keeps the order in the box', async () => {
    await mixedBox()
    fireEvent.click(screen.getByRole('button', { name: /^Öppna cateringförfrågan Gäst 1/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/catering/loc-1/req-1')
    expect(screen.getByRole('alertdialog', { name: 'Ny beställning' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Öppna cateringförfrågan/ })).toBeNull()
  })

  it('opening an order keeps the request in the box', async () => {
    await mixedBox()
    fireEvent.click(screen.getByRole('button', { name: /^Öppna #1/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/bestallningar')
    expect(screen.getByRole('alertdialog', { name: 'Ny cateringförfrågan' })).toBeInTheDocument()
  })

  it('OK still clears both', async () => {
    await mixedBox()
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('several tabs', () => {
  it('a request another tab already pinged is seen here without sound or box', async () => {
    vi.useFakeTimers()
    localStorage.setItem('booqy-catering-pinged:loc-1', JSON.stringify([{ id: 'req-2', at: Date.now() }]))
    listRequests.mockResolvedValue([])
    shell('/meny')
    await tick(0)
    await act(async () => {
      feedCatering('loc-1', [req(2)])
    })
    expect(playOrderAlert).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Nästa, som ingen annan flik har larmat om, larmar och delas vidare.
    await act(async () => {
      feedCatering('loc-1', [req(3), req(2)])
    })
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('booqy-catering-pinged:loc-1')).toContain('req-3')
  })

  it('a stale claim does not silence a request', async () => {
    vi.useFakeTimers()
    localStorage.setItem('booqy-catering-pinged:loc-1', JSON.stringify([{ id: 'req-2', at: Date.now() - 11 * 60_000 }]))
    listRequests.mockResolvedValue([])
    shell('/meny')
    await tick(0)
    await act(async () => {
      feedCatering('loc-1', [req(2)])
    })
    expect(playOrderAlert).toHaveBeenCalledTimes(1)
  })
})
