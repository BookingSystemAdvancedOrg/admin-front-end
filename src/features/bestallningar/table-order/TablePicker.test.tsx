import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TablePicker } from './TablePicker'
import { listTabs } from './tableOrderApi'
import { mockFloors, resetMockStore } from './tableOrderMock'
import type { TabsResponse } from './types'

async function data(): Promise<TabsResponse> {
  const res = await listTabs('mock')
  if ('unchanged' in res) throw new Error('unexpected')
  return res
}

beforeEach(() => resetMockStore())

describe('TablePicker', () => {
  it('lists the tables per floor with guest and state, and filters by guest', async () => {
    const { tables, tabs } = await data()
    const onPick = vi.fn()
    render(<TablePicker tables={tables} tabs={tabs} floors={mockFloors()} now={Date.now()} view="lista" onView={() => {}} onPick={onPick} />)
    expect(screen.getByRole('heading', { name: 'Matsal' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Uteservering' })).toBeInTheDocument()
    const bord3 = screen.getByRole('button', { name: /^Bord 3/ })
    expect(bord3).toHaveTextContent('Åsa Öberg')
    expect(bord3).toHaveTextContent('Öppen')
    expect(screen.getByRole('button', { name: /^Bord 7/ })).toHaveTextContent('Bokat senare')
    await userEvent.type(screen.getByRole('searchbox'), 'maja')
    expect(screen.queryByRole('button', { name: /^Bord 3/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Bord 10/ }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: '10', tabId: expect.any(String) }))
  })

  it('draws the floor plan with each table state and switches floors', async () => {
    const { tables, tabs } = await data()
    const onPick = vi.fn()
    render(<TablePicker tables={tables} tabs={tabs} floors={mockFloors()} now={Date.now()} view="karta" onView={() => {}} onPick={onPick} />)
    const map = screen.getByRole('group', { name: 'Välj bord, Matsal' })
    expect(within(map).getByRole('button', { name: /^Bord 3, Öppen, Åsa Öberg, 4 pers/ })).toBeInTheDocument()
    expect(within(map).getByRole('button', { name: /^Bord 5, Ledigt/ })).toBeInTheDocument()
    await userEvent.click(within(map).getByRole('button', { name: /^Bord 5,/ }))
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ label: '5' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Uteservering' }))
    expect(screen.getByRole('button', { name: /^Bord 12, Bokat senare, Omar Haddad/ })).toBeInTheDocument()
  })

  it('jumps to a table from the keypad', async () => {
    const { tables, tabs } = await data()
    const onPick = vi.fn()
    render(<TablePicker tables={tables} tabs={tabs} floors={[]} now={Date.now()} view="karta" onView={() => {}} onPick={onPick} />)
    // no geometry: the list is shown and there is no Karta toggle
    expect(screen.queryByRole('tab', { name: 'Karta' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Skriv bordsnummer' }))
    await userEvent.click(screen.getByRole('button', { name: '9' }))
    await userEvent.click(screen.getByRole('button', { name: '9' }))
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(await screen.findByText('Bord 99 finns inte. Kolla numret.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Radera en siffra' }))
    await userEvent.click(screen.getByRole('button', { name: 'Radera en siffra' }))
    await userEvent.click(screen.getByRole('button', { name: '1' }))
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: '12' }))
  })
})

describe('drawnSize', () => {
  it('never draws a table smaller than its text needs, with air inside', async () => {
    const { drawnSize } = await import('./FloorMap')
    const tiny = drawnSize({ w: 40, h: 40, shape: 'square', rotation: 0 }, 0.3)
    expect(tiny.w).toBeGreaterThanOrEqual(64)
    expect(tiny.h).toBeGreaterThanOrEqual(56)
    expect(tiny.textW).toBeLessThanOrEqual(tiny.w - 16)
    const round = drawnSize({ w: 40, h: 40, shape: 'round', rotation: 0 }, 0.3)
    expect(round.w).toBeGreaterThanOrEqual(68)
    expect(round.textW).toBeGreaterThan(30)
    const turned = drawnSize({ w: 200, h: 80, shape: 'square', rotation: 90 }, 1)
    expect(turned.boxW).toBeCloseTo(80)
    expect(turned.boxH).toBeCloseTo(200)
    expect(turned.textW).toBe(60)
  })
})
