import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../shared/api'
import type { Tab, TabItem, TableState, TabsResponse } from '../table-order/types'
import { TablesBoard } from './TablesBoard'

const api = {
  listTabs: vi.fn(),
  sendHeld: vi.fn(),
  closeTab: vi.fn(),
  reopenTab: vi.fn(),
  moveTab: vi.fn(),
  voidItems: vi.fn(),
  redispatchRound: vi.fn(),
}
vi.mock('../table-order/tableOrderApi', () => ({
  TAB_POLL_MS: 5000,
  newRequestId: () => 'r'.repeat(32),
  getFloorPlan: () => Promise.resolve([]),
  listTabs: (...a: unknown[]) => api.listTabs(...a),
  sendHeld: (...a: unknown[]) => api.sendHeld(...a),
  closeTab: (...a: unknown[]) => api.closeTab(...a),
  reopenTab: (...a: unknown[]) => api.reopenTab(...a),
  moveTab: (...a: unknown[]) => api.moveTab(...a),
  voidItems: (...a: unknown[]) => api.voidItems(...a),
  redispatchRound: (...a: unknown[]) => api.redispatchRound(...a),
  tabErrorText: (err: unknown) => {
    const e = err as ApiError
    return e.code === 'changed_retry'
      ? { text: 'Någon annan ändrade beställningen. Se de senaste ändringarna och försök igen.', who: 'restaurant', tab: e.details?.tab }
      : { text: 'Booqys fel.', who: 'booqy' }
  },
}))
vi.mock('../table-order/FloorMap', () => ({
  FloorMap: ({ tables, onPick }: { tables: TableState[]; onPick: (t: TableState) => void }) => (
    <div data-testid="floor-map">
      {tables.map((t) => <button key={t.tableId} type="button" onClick={() => onPick(t)}>Karta {t.label}</button>)}
    </div>
  ),
}))

function item(extra: Partial<TabItem>): TabItem {
  return {
    itemId: 'i1', menuItemId: 'm1', name: 'Toast Skagen', unitPrice: 14500, quantity: 2, options: [], course: 'starters',
    stationId: 'kok', stationName: 'Kök', state: 'sent', round: 1, addedAt: '2026-11-19T18:00:00Z', addedByName: 'Anna', ...extra,
  }
}

function tab(extra: Partial<Tab> = {}): Tab {
  return {
    tabId: 'a'.repeat(32), status: 'open', tableId: 't3', tableLabel: '3', floorName: 'Matsal', covers: 4, guestName: 'Åsa Öberg',
    reservationId: null,
    items: [item({ itemId: 's1' }), item({ itemId: 'm1', name: 'Oxfilé', unitPrice: 32500, quantity: 4, course: 'mains', state: 'held', round: undefined })],
    rounds: [{ round: 1, kind: 'order', at: '2026-11-19T18:02:00Z', byName: 'Anna', courses: ['starters'], itemIds: ['s1'], dispatched: true,
      stations: [{ stationId: 'kok', stationName: 'Kök', printers: 1, fallback: false }],
      tickets: [{ stationId: 'kok', stationName: 'Kök', status: 'ready' }] }],
    referenceTotal: 14500 * 2 + 32500 * 4, openedAt: new Date(Date.now() - 30 * 60_000).toISOString(), openedByName: 'Anna',
    version: 3, updatedAt: '2026-11-19T18:02:00Z', ...extra,
  }
}

const TABLES: TableState[] = [
  { tableId: 't3', label: '3', seats: 4, floorId: 'f', floorName: 'Matsal', tabId: 'a'.repeat(32), guest: null },
  { tableId: 't7', label: '7', seats: 2, floorId: 'f', floorName: 'Matsal', tabId: null, guest: null },
]

function response(tabs: Tab[], extra: Partial<TabsResponse> = {}): TabsResponse {
  return { version: 1, serverTime: new Date().toISOString(), tabs, closedToday: [], tables: TABLES, ...extra }
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}{l.search}</p>
}

function renderBoard(isOwner = true) {
  return render(
    <MemoryRouter initialEntries={['/bestallningar?vy=bord']}>
      <Routes>
        <Route path="*" element={<><TablesBoard locationId="loc-1" isOwner={isOwner} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listTabs.mockResolvedValue(response([tab()]))
})

describe('TablesBoard', () => {
  it('shows open tables with the counts and lights Skicka varmrätt when the starters are ready', async () => {
    renderBoard()
    const card = await screen.findByRole('article', { name: 'Bord 3, Åsa Öberg' })
    expect(within(card).getByRole('button', { name: /Skicka varmrätt/ })).toHaveClass('ready')
    expect(screen.getByRole('region', { name: 'Bord just nu' })).toBeInTheDocument()
  })

  it('fires the held course and says where it went', async () => {
    const user = userEvent.setup()
    const sent = tab({ version: 4, items: tab().items.map((i) => ({ ...i, state: 'sent' as const, round: i.round ?? 2 })) })
    api.sendHeld.mockResolvedValue({ tab: sent, round: { ...sent.rounds[0], round: 2, kind: 'fire' }, warnings: [] })
    renderBoard()
    await user.click(await screen.findByRole('button', { name: /Skicka varmrätt/ }))
    expect(api.sendHeld).toHaveBeenCalledWith('loc-1', 'a'.repeat(32), { requestId: 'r'.repeat(32), courses: ['mains'] })
    expect(await screen.findByText('Skickat till Kök')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Skicka varmrätt/ })).toBeNull()
  })

  it('closes after the guest paid in the POS, and Ångra reopens it', async () => {
    const user = userEvent.setup()
    const noneHeld = tab({ items: [item({ itemId: 's1' })] })
    api.listTabs.mockResolvedValue(response([noneHeld]))
    const closed = { ...noneHeld, status: 'closed' as const, closedAt: new Date().toISOString(), closedByName: 'Anna', version: 4 }
    api.closeTab.mockResolvedValue(closed)
    api.reopenTab.mockResolvedValue({ ...noneHeld, version: 5 })
    renderBoard()
    await user.click(await screen.findByRole('button', { name: /^Stäng$/ }))
    const dialog = screen.getByRole('dialog', { name: 'Stäng Bord 3' })
    await user.click(within(dialog).getByRole('button', { name: 'Betald i kassan, stäng' }))
    expect(api.closeTab).toHaveBeenCalledWith('loc-1', 'a'.repeat(32), { requestId: 'r'.repeat(32), expectedVersion: 3, dropHeld: false })
    expect(screen.queryByRole('article', { name: /Bord 3/ })).toBeNull()
    expect(screen.getByText(/Stängda idag/)).toHaveTextContent('Stängda idag (1)')
    const undo = screen.getByText('Bord 3 stängd').closest('div')!
    await user.click(within(undo).getByRole('button', { name: /Ångra/ }))
    expect(api.reopenTab).toHaveBeenCalled()
    expect(await screen.findByRole('article', { name: 'Bord 3, Åsa Öberg' })).toBeInTheDocument()
  })

  it('shows the fresh tab and the reason when someone else changed it (409)', async () => {
    const user = userEvent.setup()
    api.listTabs.mockResolvedValue(response([tab({ items: [item({ itemId: 's1' })] })]))
    const fresh = tab({ version: 9, items: [item({ itemId: 's1' }), item({ itemId: 'x', name: 'Burrata', state: 'held', round: undefined })] })
    api.closeTab.mockImplementation(() => {
      api.listTabs.mockResolvedValue(response([fresh], { version: 2 }))
      return Promise.reject(new ApiError(409, 'changed_retry', { code: 'changed_retry', details: { tab: fresh } }))
    })
    renderBoard()
    await user.click(await screen.findByRole('button', { name: /^Stäng$/ }))
    await user.click(screen.getByRole('button', { name: 'Betald i kassan, stäng' }))
    const dialog = screen.getByRole('dialog', { name: 'Stäng Bord 3' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Någon annan ändrade beställningen')
    expect(within(dialog).getByRole('note')).toHaveTextContent('Förrätt 2 har inte skickats.')
  })

  it('opens the detail, voids a sent dish with a reason', async () => {
    const user = userEvent.setup()
    api.voidItems.mockResolvedValue({ tab: tab({ version: 4 }), round: null, warnings: [] })
    renderBoard()
    await user.click(await screen.findByRole('button', { name: 'Visa Bord 3' }))
    const detail = screen.getByRole('complementary', { name: 'Bord 3, detaljer' })
    await user.click(within(detail).getByRole('button', { name: 'Makulera' }))
    const dialog = screen.getByRole('dialog', { name: 'Makulera på Bord 3' })
    await user.click(within(dialog).getByRole('button', { name: 'En till Toast Skagen' }))
    await user.click(within(dialog).getByRole('radio', { name: 'Gästen ändrade sig' }))
    await user.click(within(dialog).getByRole('button', { name: 'Makulera 1' }))
    expect(api.voidItems).toHaveBeenCalledWith('loc-1', 'a'.repeat(32), {
      requestId: 'r'.repeat(32), expectedVersion: 3, items: [{ itemId: 's1', quantity: 1 }], reason: 'guest_changed',
    })
  })

  it('moves the guests to a free table', async () => {
    const user = userEvent.setup()
    api.moveTab.mockResolvedValue({ tab: tab({ tableId: 't7', tableLabel: '7', version: 4 }), round: null, warnings: [] })
    renderBoard()
    await user.click(await screen.findByRole('button', { name: 'Visa Bord 3' }))
    await user.click(screen.getByRole('button', { name: 'Flytta' }))
    const dialog = screen.getByRole('dialog', { name: 'Flytta Bord 3' })
    expect(within(dialog).queryByRole('radio', { name: /^3/ })).toBeNull()
    await user.click(within(dialog).getByRole('radio', { name: /7/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Flytta till bord 7' }))
    expect(api.moveTab).toHaveBeenCalledWith('loc-1', 'a'.repeat(32), { requestId: 'r'.repeat(32), expectedVersion: 3, tableId: 't7' })
    expect(await screen.findByText('Flyttad till Bord 7')).toBeInTheDocument()
  })

  it('starts a new order from a free table on the map, and opens an occupied one', async () => {
    const user = userEvent.setup()
    renderBoard()
    await screen.findByRole('article', { name: 'Bord 3, Åsa Öberg' })
    await user.click(screen.getByRole('tab', { name: /Karta/ }))
    await user.click(screen.getByRole('button', { name: 'Karta 3' }))
    expect(screen.getByRole('complementary', { name: 'Bord 3, detaljer' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Karta 7' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/bestallningar/bord/ny?bord=t7')
  })

  it('goes to add mode from the card', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(await screen.findByRole('button', { name: /Lägg till/ }))
    expect(screen.getByTestId('where')).toHaveTextContent(`/bestallningar/bord/${'a'.repeat(32)}/lagg-till`)
  })

  it('says who acts when there are no tables', async () => {
    api.listTabs.mockResolvedValue(response([], { tables: [] }))
    renderBoard(false)
    expect(await screen.findByText(/Be ägaren publicera bord i Planritning/)).toBeInTheDocument()
  })

  it('shows the empty state with the call to action', async () => {
    api.listTabs.mockResolvedValue(response([], { tables: TABLES.map((t) => ({ ...t, tabId: null })) }))
    renderBoard()
    expect(await screen.findByText('Inga öppna bord')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ny bordsbeställning/ })).toBeInTheDocument()
  })
})
