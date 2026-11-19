import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkError } from '../../../shared/api'
import TakeOrderPage from './TakeOrderPage'
import { listTabs } from './tableOrderApi'
import type * as Api from './tableOrderApi'
import { mockOpen, resetMockStore } from './tableOrderMock'

const h = vi.hoisted(() => ({ real: null as unknown as typeof Api }))
const { openTab, addItems } = vi.hoisted(() => ({ openTab: vi.fn(), addItems: vi.fn() }))

vi.mock('./tableOrderApi', async (orig) => {
  const mod = await orig<typeof Api>()
  h.real = mod
  return {
    ...mod,
    openTab: (...a: Parameters<typeof mod.openTab>) => openTab(...a),
    addItems: (...a: Parameters<typeof mod.addItems>) => addItems(...a),
  }
})
vi.mock('../../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ sub: 'staff' }) }))
vi.mock('../../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))
vi.mock('../../../shared/tenant', () => ({ useTenant: () => ({ tenant: { role: 'staff_user' } }) }))

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.pathname + loc.search}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/bestallningar/bord/ny" element={<TakeOrderPage />} />
        <Route path="/bestallningar/bord/:tabId/lagg-till" element={<TakeOrderPage />} />
        <Route path="/bestallningar" element={<p>Bord-vyn</p>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const tile = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}, `) })
const summary = () => screen.getByRole('complementary', { name: 'Beställning' })

beforeEach(() => {
  resetMockStore()
  localStorage.clear()
  openTab.mockReset()
  addItems.mockReset()
  openTab.mockImplementation((...a: Parameters<typeof h.real.openTab>) => h.real.openTab(...a))
  addItems.mockImplementation((...a: Parameters<typeof h.real.addItems>) => h.real.addItems(...a))
})

describe('TakeOrderPage', () => {
  it('picks a table, adds dishes, holds mains behind the starters and sends', async () => {
    const user = userEvent.setup()
    renderAt('/bestallningar/bord/ny')
    await user.click(await screen.findByRole('tab', { name: 'Lista' }))
    await user.click(screen.getByRole('button', { name: /^Bord 5/ }))
    expect(await screen.findByRole('heading', { name: 'Ny bordsbeställning' })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /^Toast Skagen, / }))
    await user.click(tile('Toast Skagen'))
    await user.click(tile('Pilsner'))
    // Oxfilé needs Stekgrad first
    await user.click(tile('Oxfilé'))
    await user.click(await screen.findByRole('button', { name: 'Medium rare' }))
    await user.click(screen.getByRole('button', { name: 'Lägg till' }))

    const panel = summary()
    const mains = within(panel).getByRole('region', { name: 'Varmrätt' })
    expect(within(mains).getByRole('radio', { name: 'Vänta' })).toHaveAttribute('aria-checked', 'true')
    const starters = within(panel).getByRole('region', { name: 'Förrätt' })
    expect(within(starters).getByRole('radio', { name: 'Skicka nu' })).toHaveAttribute('aria-checked', 'true')
    expect(within(panel).getByText('Varmrätt 1')).toBeInTheDocument()
    expect(within(panel).getByText(/Att slå in/)).toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: /Skicka$/ }))
    expect(openTab).toHaveBeenCalledTimes(1)
    const body = openTab.mock.calls[0][1]
    expect(body.tableId).toBe('mock-t5')
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ menuItemId: 'm-skagen', quantity: 2, course: 'starters', hold: false }),
      expect.objectContaining({ menuItemId: 'm-pilsner', quantity: 1, course: 'drinks', hold: false }),
      expect.objectContaining({ menuItemId: 'm-oxfile', options: [{ group: 'Stekgrad', choice: 'Medium rare' }], course: 'mains', hold: true }),
    ]))
    expect(await screen.findByText('Skickat till Kök och Bar')).toBeInTheDocument()
    expect(screen.getByText('Bar har ingen skrivare, bongen skrevs ut i köket.')).toBeInTheDocument()
    const res = await listTabs('mock')
    if ('unchanged' in res) throw new Error('unexpected')
    expect(res.tables.find((t) => t.label === '5')!.tabId).toBeTruthy()
  })

  it('a network failure keeps the cart and retries with the same requestId', async () => {
    const user = userEvent.setup()
    openTab.mockRejectedValueOnce(new NetworkError())
    renderAt('/bestallningar/bord/ny?bord=mock-t5')
    await user.click(await screen.findByRole('button', { name: /^Cola, / }))
    await user.click(within(summary()).getByRole('button', { name: /Skicka$/ }))
    expect(await screen.findByText(/Vi når inte Booqy just nu/)).toBeInTheDocument()
    const retry = within(summary()).getByRole('button', { name: /Försök igen$/ })
    expect(within(summary()).getByText('Cola')).toBeInTheDocument()
    await user.click(retry)
    expect(openTab).toHaveBeenCalledTimes(2)
    expect(openTab.mock.calls[1][1].requestId).toBe(openTab.mock.calls[0][1].requestId)
    expect(await screen.findByText('Skickat till Bar')).toBeInTheDocument()
  })

  it('flipping a course after a failed send makes the next send a new request with the new choice', async () => {
    const user = userEvent.setup()
    openTab.mockRejectedValueOnce(new NetworkError())
    renderAt('/bestallningar/bord/ny?bord=mock-t5')
    await user.click(await screen.findByRole('button', { name: /^Cola, / }))
    await user.click(within(summary()).getByRole('button', { name: /Skicka$/ }))
    expect(await within(summary()).findByRole('button', { name: /Försök igen$/ })).toBeInTheDocument()
    const drinks = within(summary()).getByRole('region', { name: 'Dryck' })
    await user.click(within(drinks).getByRole('radio', { name: 'Vänta' }))
    await user.click(within(summary()).getByRole('button', { name: /Skicka$/ }))
    expect(openTab).toHaveBeenCalledTimes(2)
    expect(openTab.mock.calls[1][1].requestId).not.toBe(openTab.mock.calls[0][1].requestId)
    expect(openTab.mock.calls[1][1].items).toEqual([expect.objectContaining({ menuItemId: 'm-cola', hold: true })])
  })

  it('two quick taps on Skicka send once', async () => {
    const user = userEvent.setup()
    renderAt('/bestallningar/bord/ny?bord=mock-t5')
    await user.click(await screen.findByRole('button', { name: /^Cola, / }))
    const send = within(summary()).getByRole('button', { name: /Skicka$/ })
    await user.dblClick(send)
    expect(openTab).toHaveBeenCalledTimes(1)
  })

  it('a table another waiter just opened switches to add mode and keeps the cart', async () => {
    const user = userEvent.setup()
    renderAt('/bestallningar/bord/ny?bord=mock-t5')
    await user.click(await screen.findByRole('button', { name: /^Cola, / }))
    // someone else opens Bord 5 meanwhile, on another device (no event on this one)
    await mockOpen({ requestId: h.real.newRequestId(), tableId: 'mock-t5', items: [{ menuItemId: 'm-vatten', quantity: 1 }] })
    await user.click(within(summary()).getByRole('button', { name: /Skicka$/ }))
    expect(await screen.findByText(/Bord 5 har redan en öppen beställning/)).toBeInTheDocument()
    // the router may apply the new location a render after the notice
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/\/lagg-till$/))
    expect(await screen.findByRole('heading', { name: 'Lägg till på Bord 5' })).toBeInTheDocument()
    expect(within(summary()).getByText('Cola')).toBeInTheDocument()
    await user.click(within(summary()).getByRole('button', { name: /Skicka$/ }))
    expect(addItems).toHaveBeenCalledTimes(1)
    expect(addItems.mock.calls[0][2].items).toEqual([expect.objectContaining({ menuItemId: 'm-cola', quantity: 1 })])
  })

  it('adds to an open tab and shows what was already sent', async () => {
    const user = userEvent.setup()
    renderAt('/bestallningar/bord/ny?bord=mock-t3')
    expect(await screen.findByRole('heading', { name: 'Lägg till på Bord 3' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^Chokladfondant, / }))
    const panel = summary()
    expect(within(panel).getByText(/Redan skickat/)).toBeInTheDocument()
    // the tab has starters and mains: desserts wait
    expect(within(within(panel).getByRole('region', { name: 'Efterrätt' })).getByRole('radio', { name: 'Vänta' }))
      .toHaveAttribute('aria-checked', 'true')
    await user.click(within(panel).getByRole('button', { name: /Skicka$/ }))
    expect(addItems).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Sparat')).toBeInTheDocument()
  })

  it('keeps an unsent cart as a draft and restores it', async () => {
    const user = userEvent.setup()
    const first = renderAt('/bestallningar/bord/ny?bord=mock-t5')
    await user.click(await screen.findByRole('button', { name: /^Cola, / }))
    first.unmount()
    renderAt('/bestallningar/bord/ny')
    await user.click(await screen.findByRole('button', { name: /Fortsätt där du var/ }))
    expect(await screen.findByText('Cola', { selector: '.to-line-name' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toBe('/bestallningar/bord/ny?bord=mock-t5')
  })
})
