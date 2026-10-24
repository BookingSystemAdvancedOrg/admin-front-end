import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TaBetaltPage, { POLL_MS } from './TaBetaltPage'
import { ApiError } from '../../shared/api'
import type { CardPayment } from './cardApi'

const api = {
  listReaders: vi.fn(),
  listPayments: vi.fn(),
  listPayableOrders: vi.fn(),
  createPayment: vi.fn(),
  getPayment: vi.fn(),
  act: vi.fn(),
  simulate: vi.fn(),
}
vi.mock('./cardApi', async (orig) => ({
  ...(await orig<typeof import('./cardApi')>()),
  listReaders: (...a: unknown[]) => api.listReaders(...a),
  listPayments: (...a: unknown[]) => api.listPayments(...a),
  listPayableOrders: (...a: unknown[]) => api.listPayableOrders(...a),
  createPayment: (...a: unknown[]) => api.createPayment(...a),
  getPayment: (...a: unknown[]) => api.getPayment(...a),
  act: (...a: unknown[]) => api.act(...a),
  simulate: (...a: unknown[]) => api.simulate(...a),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant: { role: 'owner_user' } }) }))
vi.mock('../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))

const READERS = [
  { id: 'tmr_a', label: 'Kassan', status: 'online', simulated: true },
  { id: 'tmr_b', label: 'Baren', status: 'offline' },
]

function payment(extra: Partial<CardPayment> = {}): CardPayment {
  return { paymentId: 'c'.repeat(32), locationId: 'loc-1', date: '2026-10-24', amount: 12550, readerId: 'tmr_a',
    readerLabel: 'Kassan', status: 'processing', attempt: 1, ...extra }
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  api.listReaders.mockResolvedValue({ enabled: true, readers: READERS })
  api.listPayments.mockResolvedValue({ date: '2026-10-24', enabled: true, payments: [] })
  api.listPayableOrders.mockResolvedValue([])
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('TaBetaltPage', () => {
  it('takes a payment in öre on the chosen reader, then shows Betalt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    api.createPayment.mockResolvedValue(payment())
    render(<TaBetaltPage />)
    await user.type(await screen.findByLabelText('Belopp'), '125,50')
    await user.click(screen.getByRole('button', { name: 'Ta betalt 125,50 kr' }))
    expect(api.createPayment).toHaveBeenCalledWith('loc-1', expect.objectContaining({ amount: 12550, readerId: 'tmr_a' }))
    expect(api.createPayment.mock.calls[0][1].checkoutId).toMatch(/^[0-9a-f]{32}$/)
    expect(await screen.findByRole('status')).toHaveTextContent('Väntar på kort')
    expect(localStorage.getItem('booqy-card-reader:loc-1')).toBe('tmr_a')

    api.getPayment.mockResolvedValue(payment({ status: 'succeeded', card: { brand: 'visa', last4: '4242' } }))
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 10)
    })
    expect(await screen.findByText('Betalt')).toBeInTheDocument()
    expect(screen.getByText(/Visa \*\*\*\* 4242/)).toBeInTheDocument()
  })

  it('shows Nekat with the reason and retries the same payment', async () => {
    const user = userEvent.setup()
    api.createPayment.mockResolvedValue(payment({ status: 'failed', failure: { code: 'insufficient_funds' } }))
    api.act.mockResolvedValue(payment({ attempt: 2 }))
    render(<TaBetaltPage />)
    await user.type(await screen.findByLabelText('Belopp'), '125,50')
    await user.click(screen.getByRole('button', { name: /Ta betalt/ }))
    expect(await screen.findByText('Nekat')).toBeInTheDocument()
    expect(screen.getByText(/otillräckligt saldo/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(api.act).toHaveBeenCalledWith('loc-1', 'c'.repeat(32), 'retry', undefined)
    expect(await screen.findByText('Väntar på kort…')).toBeInTheDocument()
  })

  it('cancels a waiting payment on the reader', async () => {
    const user = userEvent.setup()
    api.createPayment.mockResolvedValue(payment())
    api.act.mockResolvedValue(payment({ status: 'canceled' }))
    render(<TaBetaltPage />)
    await user.type(await screen.findByLabelText('Belopp'), '50')
    await user.click(screen.getByRole('button', { name: /Ta betalt/ }))
    await user.click(await screen.findByRole('button', { name: 'Avbryt' }))
    expect(api.act).toHaveBeenCalledWith('loc-1', 'c'.repeat(32), 'cancel', undefined)
    expect(await screen.findByText('Avbruten')).toBeInTheDocument()
  })

  it('refuses amounts under the minimum before calling the API', async () => {
    const user = userEvent.setup()
    render(<TaBetaltPage />)
    await user.type(await screen.findByLabelText('Belopp'), '2')
    expect(screen.getByText(/Ange ett belopp mellan/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ta betalt/ })).toBeDisabled()
  })

  it('remembers the last reader on this device', async () => {
    localStorage.setItem('booqy-card-reader:loc-1', 'tmr_b')
    render(<TaBetaltPage />)
    expect(await screen.findByLabelText('Kortläsare')).toHaveValue('tmr_b')
    expect(screen.getByText(/Läsaren är offline/)).toBeInTheDocument()
  })

  it('says clearly when no reader is connected', async () => {
    api.listReaders.mockResolvedValue({ enabled: true, readers: [] })
    render(<TaBetaltPage />)
    expect(await screen.findByText('Ingen kortläsare kopplad')).toBeInTheDocument()
  })

  it('owner refunds a paid free-amount payment in two steps', async () => {
    const user = userEvent.setup()
    api.listPayments.mockResolvedValue({ date: '2026-10-24', enabled: true,
      payments: [payment({ status: 'succeeded', paidAt: '2026-10-24T12:00:00Z' })] })
    api.act.mockResolvedValue(payment({ status: 'refunded' }))
    render(<TaBetaltPage />)
    await user.click(await screen.findByRole('button', { name: 'Återbetala' }))
    await user.click(screen.getByRole('button', { name: 'Bekräfta: återbetala 125,50 kr' }))
    expect(api.act).toHaveBeenCalledWith('loc-1', 'c'.repeat(32), 'refund')
    expect(await screen.findByText('Återbetald')).toBeInTheDocument()
  })

  it('shows the API error text', async () => {
    const user = userEvent.setup()
    api.createPayment.mockRejectedValue(new ApiError(409, 'terminal_not_enabled'))
    render(<TaBetaltPage />)
    await user.type(await screen.findByLabelText('Belopp'), '50')
    await user.click(screen.getByRole('button', { name: /Ta betalt/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('inte aktiverade')
  })
})
