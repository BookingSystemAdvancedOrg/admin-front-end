import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, OrderList } from '../../features/bestallningar/ordersApi'

const listOrders = vi.fn()
const unlockOrderAudio = vi.fn()
const playOrderAlert = vi.fn()
let tenant: Record<string, unknown> = {}
let status = 'ready'

vi.mock('./alertSound', () => ({
  playOrderAlert: () => playOrderAlert(),
  unlockOrderAudio: () => unlockOrderAudio(),
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

const { OrderAlert, OrderAlertDialog } = await import('./OrderAlert')
const { ALERT_POLL_MS } = await import('./watch')
const { feedOrders, resetOrderAlerts, takeOrderFocus } = await import('./store')
const { fromStored } = await import('./queue')

function order(n: number, extra: Partial<Order> = {}): Order {
  return {
    orderId: `order-${n}`, locationId: 'loc-1', number: n, status: 'confirmed', mode: 'pickup',
    lines: [
      { menuItemId: 'burgare', name: 'Burgarmeny', unitPrice: 15900, quantity: 1, total: 15900, vatRate: 6, allergy: n === 2 ? 'nötter' : undefined },
      { menuItemId: 'skagen', name: 'Toast Skagen', unitPrice: 9800, quantity: 2, total: 19600, vatRate: 6 },
    ],
    totalAmount: 35500, customerName: `Gäst ${n}`, confirmedAt: `2026-11-21T17:${String(10 + n).padStart(2, '0')}:00Z`, ...extra,
  }
}

const list = (orders: Order[]): OrderList => ({ date: '2026-11-21', ordering: { open: true }, orders })

beforeEach(() => {
  resetOrderAlerts()
  listOrders.mockReset()
  unlockOrderAudio.mockReset()
  playOrderAlert.mockReset()
  playOrderAlert.mockResolvedValue('played')
  tenant = { role: 'owner_user', entitlements: { features: { ordering: true } } }
  status = 'ready'
})
afterEach(() => {
  vi.useRealTimers()
  resetOrderAlerts()
})

describe('OrderAlertDialog', () => {
  const props = { muted: false, rev: 1, latest: [] as string[], onOk: vi.fn(), onOpen: vi.fn(), guardMs: 0 }

  it('is an alert dialog with the order, focus on the blue OK button', () => {
    render(<OrderAlertDialog {...props} orders={[order(1)]} />)
    const dialog = screen.getByRole('alertdialog', { name: 'Ny beställning' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const ok = within(dialog).getByRole('button', { name: 'OK' })
    expect(ok).toHaveFocus()
    expect(ok).toHaveClass('btn', 'primary')
    const slip = within(dialog).getByRole('button', { name: /Öppna #1, Gäst 1, \d\d:\d\d, 355 kr/ })
    expect(slip).toHaveTextContent('Burgarmeny, 2 × Toast Skagen')
    expect(within(dialog).queryByText('Tryck för att slå på ljudet')).toBeNull()
  })

  it('OK and Escape close it', () => {
    const onOk = vi.fn()
    const { unmount } = render(<OrderAlertDialog {...props} onOk={onOk} orders={[order(1)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onOk).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOk).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('ignores an OK that was already on its way when the box opened', () => {
    const onOk = vi.fn()
    render(<OrderAlertDialog {...props} guardMs={600} onOk={onOk} orders={[order(1)]} />)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOk).not.toHaveBeenCalled()
  })

  it('counts stacked orders in the title, newest first, and announces the new one', () => {
    const { rerender } = render(<OrderAlertDialog {...props} orders={[order(2), order(1)]} />)
    expect(screen.getByRole('alertdialog', { name: 'Nya beställningar 2' })).toBeInTheDocument()
    rerender(<OrderAlertDialog {...props} rev={2} latest={['order-3']} orders={[order(3), order(2), order(1)]} />)
    const dialog = screen.getByRole('alertdialog', { name: 'Nya beställningar 3' })
    const slips = within(dialog).getAllByRole('button', { name: /^Öppna/ })
    expect(slips.map((s) => s.getAttribute('aria-label')?.slice(0, 8))).toEqual(['Öppna #3', 'Öppna #2', 'Öppna #1'])
    expect(slips[0].closest('li')).toHaveClass('is-new')
    expect(slips[1].closest('li')).not.toHaveClass('is-new')
    expect(within(dialog).getByText(/^Ny beställning #3, Gäst 3, \d\d:\d\d, 355 kr$/)).toBeInTheDocument()
    expect(within(slips[1]).getByText('Allergi')).toBeInTheDocument()
    // Fokus står kvar på OK när en ny rad kommer.
    expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveFocus()
  })

  it('shows tap-for-sound while the browser blocks audio; the tap wakes the audio and focus stays on OK', () => {
    const { rerender } = render(<OrderAlertDialog {...props} muted orders={[order(1)]} />)
    const hint = screen.getByRole('button', { name: 'Tryck för att slå på ljudet' })
    hint.focus()
    fireEvent.click(hint)
    expect(unlockOrderAudio).toHaveBeenCalledTimes(1)
    rerender(<OrderAlertDialog {...props} muted={false} orders={[order(1)]} />)
    expect(screen.queryByRole('button', { name: 'Tryck för att slå på ljudet' })).toBeNull()
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()
  })

  it('also guards the rows against a tap that was on its way', () => {
    const onOpen = vi.fn()
    render(<OrderAlertDialog {...props} guardMs={600} onOpen={onOpen} orders={[order(1)]} />)
    fireEvent.click(screen.getByRole('button', { name: /^Öppna #1/ }), { detail: 1 })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('describes the newest order for screen readers', () => {
    render(<OrderAlertDialog {...props} orders={[order(2), order(1)]} />)
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(/^Senaste #2, Gäst 2, \d\d:\d\d, 355 kr, allergi$/)
  })

  it('makes the page behind inert, keeps focus in the box and gives it back on close', () => {
    const root = document.createElement('div')
    root.id = 'root'
    const field = document.createElement('input')
    const other = document.createElement('button')
    root.append(field, other)
    document.body.append(root)
    field.focus()
    const { unmount } = render(<OrderAlertDialog {...props} orders={[order(1)]} />)
    expect(root.inert).toBe(true)
    const ok = screen.getByRole('button', { name: 'OK' })
    expect(ok).toHaveFocus()
    // Något bakom försöker ta fokus: det går tillbaka till OK.
    other.focus()
    expect(ok).toHaveFocus()
    unmount()
    expect(root.inert).toBe(false)
    expect(field).toHaveFocus()
    root.remove()
  })

  it('Escape closes the box even when a dialog under it listens too (keys installed at start)', async () => {
    const { installOrderAlertKeys } = await import('./store')
    installOrderAlertKeys()
    const under = vi.fn((e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopImmediatePropagation()
    })
    window.addEventListener('keydown', under, true)
    const onOk = vi.fn()
    const { unmount } = render(<OrderAlertDialog {...props} onOk={onOk} orders={[order(1)]} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()
    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(under).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', under, true)
  })

  it('a row opens that order', () => {
    const onOpen = vi.fn()
    render(<OrderAlertDialog {...props} onOpen={onOpen} orders={[order(2), order(1)]} />)
    fireEvent.click(screen.getByRole('button', { name: /^Öppna #1/ }))
    expect(onOpen).toHaveBeenCalledWith('order-1')
  })

  it('keeps Tab inside the box', () => {
    render(<OrderAlertDialog {...props} orders={[order(1)]} />)
    const ok = screen.getByRole('button', { name: 'OK' })
    fireEvent.keyDown(ok, { key: 'Tab' })
    expect(screen.getByRole('button', { name: /^Öppna #1/ })).toHaveFocus()
  })
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

async function tick(ms = ALERT_POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('OrderAlert in the shell', () => {
  it('polls on any page: no box on the first list, a box and sound for a new order, appended until OK', async () => {
    vi.useFakeTimers()
    listOrders.mockResolvedValue(list([order(1)]))
    shell()
    await tick(0)
    expect(listOrders).toHaveBeenCalledWith('loc-1')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(playOrderAlert).not.toHaveBeenCalled()

    listOrders.mockResolvedValue(list([order(1), order(2)]))
    await tick()
    expect(screen.getByRole('alertdialog', { name: 'Ny beställning' })).toBeInTheDocument()
    expect(playOrderAlert).toHaveBeenCalledTimes(1)

    listOrders.mockResolvedValue(list([order(1), order(2), order(3)]))
    await tick()
    expect(screen.getByRole('alertdialog', { name: 'Nya beställningar 2' })).toBeInTheDocument()
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(playOrderAlert).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // Samma lista igen: inget nytt.
    await tick()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    listOrders.mockResolvedValue(list([order(1), order(2), order(3), order(4)]))
    await tick()
    expect(screen.getByRole('alertdialog', { name: 'Ny beställning' })).toBeInTheDocument()
    expect(playOrderAlert).toHaveBeenCalledTimes(3)
  })

  it('a row goes to Beställningar with that order and closes the box', async () => {
    vi.useFakeTimers()
    listOrders.mockResolvedValue(list([]))
    shell('/meny')
    await tick(0)
    listOrders.mockResolvedValue(list([order(1), order(2)]))
    await tick()
    fireEvent.click(screen.getByRole('button', { name: /^Öppna #1/ }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/bestallningar')
    expect(takeOrderFocus()).toBe('order-1')
  })

  it('does not fetch while Beställningar feeds the list itself, and takes over when it stops', async () => {
    vi.useFakeTimers()
    listOrders.mockResolvedValue(list([order(1)]))
    shell('/bestallningar')
    await tick(0)
    expect(listOrders).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 4; i++) {
      feedOrders('loc-1', [order(1)])
      await tick(ALERT_POLL_MS)
    }
    expect(listOrders).toHaveBeenCalledTimes(1)
    // Sidan har slutat mata: skalet hämtar igen strax efter (11,5 s efter sidans sista).
    await tick(3000)
    expect(listOrders).toHaveBeenCalledTimes(2)
  })

  it('brings an open box back after a reload, without sound, also while the restaurant is still loading', async () => {
    vi.useFakeTimers()
    const raw = JSON.stringify({ v: 1, loc: 'loc-1', seen: ['order-1', 'order-2'], open: ['order-2'], at: Date.now() })
    resetOrderAlerts(fromStored(raw, Date.now()))
    listOrders.mockResolvedValue(list([order(1), order(2)]))
    status = 'loading'
    const view = shell()
    await tick(0)
    status = 'ready'
    view.rerender(
      <MemoryRouter initialEntries={['/meny']}>
        <OrderAlert guardMs={0} />
      </MemoryRouter>,
    )
    await tick(0)
    expect(screen.getByRole('alertdialog', { name: 'Ny beställning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Öppna #2/ })).toBeInTheDocument()
    expect(playOrderAlert).not.toHaveBeenCalled()
  })

  it('stays quiet for staff without Beställningar', async () => {
    vi.useFakeTimers()
    tenant = { role: 'staff_user', access: { areas: ['bokningar'] }, entitlements: { features: { ordering: true } } }
    listOrders.mockResolvedValue(list([]))
    shell()
    await tick(0)
    await tick()
    expect(listOrders).not.toHaveBeenCalled()
  })
})
