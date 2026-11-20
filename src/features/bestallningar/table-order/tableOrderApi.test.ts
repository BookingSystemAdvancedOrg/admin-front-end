import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../../shared/api'
import { errorInfo } from '../../../shared/errors'
import {
  addItems,
  closeTab,
  editTab,
  getTabMenu,
  listTabs,
  mockSentRounds,
  moveTab,
  newRequestId,
  openTab,
  reopenTab,
  sendHeld,
  tabErrorText,
  voidItems,
} from './tableOrderApi'
import { resetMockStore } from './tableOrderMock'
import type { TabsResponse } from './types'

const LOC = 'mock'

async function list(): Promise<TabsResponse> {
  const res = await listTabs(LOC)
  if ('unchanged' in res) throw new Error('unexpected')
  return res
}

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (err) {
    return err as ApiError
  }
  throw new Error('expected an error')
}

beforeEach(() => resetMockStore())

describe('table order API (mock store)', () => {
  it('lists the open tabs and every table with its state', async () => {
    const res = await list()
    expect(res.tabs.map((t) => t.tableLabel)).toEqual(['10', '3'])
    expect(res.tables).toHaveLength(14)
    const t3 = res.tables.find((t) => t.label === '3')!
    expect(t3.tabId).toBe(res.tabs.find((t) => t.tableLabel === '3')!.tabId)
    expect(t3.guest).toMatchObject({ name: 'Åsa Öberg', partySize: 4, status: 'arrived' })
    expect(res.tables.find((t) => t.label === '7')!.guest?.upcoming).toBe(true)
  })

  it('answers unchanged when nothing changed since a version', async () => {
    const res = await list()
    expect(await listTabs(LOC, res.version)).toEqual({ unchanged: true, version: res.version })
  })

  it('routes drinks to the bar (printing on the kitchen printer) and food to the kitchen', async () => {
    const res = await openTab(LOC, {
      requestId: newRequestId(),
      tableId: 'mock-t5',
      covers: 2,
      items: [
        { menuItemId: 'm-pilsner', quantity: 2 },
        { menuItemId: 'm-skagen', quantity: 1 },
      ],
    })
    expect(res.tab.status).toBe('open')
    expect(res.round?.kind).toBe('order')
    expect(res.round?.stations).toEqual([
      { stationId: 'bar', stationName: 'Bar', printers: 0, fallback: true },
      { stationId: 'kok', stationName: 'Kök', printers: 1, fallback: false },
    ])
    expect(res.tab.referenceTotal).toBe(2 * 7900 + 16500)
  })

  it('a retry with the same requestId never makes a second round', async () => {
    const body = { requestId: newRequestId(), tableId: 'mock-t5', items: [{ menuItemId: 'm-cola', quantity: 1 }] }
    const first = await openTab(LOC, body)
    const again = await openTab(LOC, body)
    expect(again.replayed).toBe(true)
    expect(again.tab.tabId).toBe(first.tab.tabId)
    expect(again.tab.rounds).toHaveLength(1)
  })

  it('one open order per table: a second open answers 409 with the open tab', async () => {
    const err = await caught(openTab(LOC, { requestId: newRequestId(), tableId: 'mock-t3', items: [{ menuItemId: 'm-cola', quantity: 1 }] }))
    expect(err.status).toBe(409)
    expect(err.code).toBe('table_has_open_order')
    const info = tabErrorText(err)
    expect(info.text).toBe('Bord 3 har redan en öppen beställning.')
    expect(info.who).toBe('restaurant')
    expect(info.tab?.tableLabel).toBe('3')
  })

  it('held courses stay off the tickets until they are fired', async () => {
    const res = await openTab(LOC, {
      requestId: newRequestId(),
      tableId: 'mock-t8',
      items: [
        { menuItemId: 'm-burrata', quantity: 2, hold: false },
        { menuItemId: 'm-torsk', quantity: 2, hold: true },
      ],
    })
    const torsk = res.tab.items.find((i) => i.menuItemId === 'm-torsk')!
    expect(torsk.state).toBe('held')
    expect(res.round?.itemIds).not.toContain(torsk.itemId)
    const fired = await sendHeld(LOC, res.tab.tabId, { requestId: newRequestId(), courses: ['mains'] })
    expect(fired.round).toMatchObject({ kind: 'fire', courses: ['mains'], itemIds: [torsk.itemId] })
    expect(mockSentRounds().some((r) => r.tabId === res.tab.tabId && r.fire === 'mains')).toBe(true)
  })

  it('requires the dish options and refuses unknown dishes', async () => {
    const opt = await caught(openTab(LOC, { requestId: newRequestId(), tableId: 'mock-t8', items: [{ menuItemId: 'm-oxfile', quantity: 1 }] }))
    expect(opt.code).toBe('option_required')
    const gone = await caught(openTab(LOC, { requestId: newRequestId(), tableId: 'mock-t8', items: [{ menuItemId: 'nope', quantity: 1 }] }))
    expect(gone.code).toBe('menu_item_unavailable')
    expect(tabErrorText(gone).who).toBe('restaurant')
  })

  it('adds to an open tab and voids sent items as a void round', async () => {
    const { tabs } = await list()
    const t3 = tabs.find((t) => t.tableLabel === '3')!
    const added = await addItems(LOC, t3.tabId, { requestId: newRequestId(), items: [{ menuItemId: 'm-cola', quantity: 2 }] })
    const cola = added.tab.items.find((i) => i.menuItemId === 'm-cola')!
    const voided = await voidItems(LOC, t3.tabId, {
      requestId: newRequestId(), expectedVersion: added.tab.version, items: [{ itemId: cola.itemId, quantity: 1 }], reason: 'wrong',
    })
    expect(voided.round?.kind).toBe('void')
    expect(voided.tab.items.filter((i) => i.menuItemId === 'm-cola').map((i) => [i.state, i.quantity])).toEqual([['sent', 1], ['void', 1]])
    expect(voided.tab.referenceTotal).toBe(added.tab.referenceTotal - 4500)
  })

  it('a stale version answers changed_retry with the fresh tab', async () => {
    const { tabs } = await list()
    const t3 = tabs.find((t) => t.tableLabel === '3')!
    const err = await caught(editTab(LOC, t3.tabId, { requestId: newRequestId(), expectedVersion: t3.version - 1, covers: 5 }))
    expect(err.code).toBe('changed_retry')
    expect(tabErrorText(err).tab?.tabId).toBe(t3.tabId)
  })

  it('closing refuses held items unless dropped, then the table is free; Ångra reopens', async () => {
    const { tabs } = await list()
    const t3 = tabs.find((t) => t.tableLabel === '3')!
    const held = await caught(closeTab(LOC, t3.tabId, { requestId: newRequestId(), expectedVersion: t3.version }))
    expect(held.code).toBe('held_items')
    const closed = await closeTab(LOC, t3.tabId, { requestId: newRequestId(), expectedVersion: t3.version, dropHeld: true })
    expect(closed.status).toBe('closed')
    expect(closed.items.filter((i) => i.voidReason === 'closed')).toHaveLength(2)
    const after = await list()
    expect(after.tables.find((t) => t.label === '3')!.tabId).toBeNull()
    expect(after.closedToday.map((t) => t.tabId)).toContain(t3.tabId)
    const reopened = await reopenTab(LOC, t3.tabId, { requestId: newRequestId() })
    expect(reopened.status).toBe('open')
  })

  it('moves a tab to a free table only', async () => {
    const { tabs } = await list()
    const t3 = tabs.find((t) => t.tableLabel === '3')!
    const busy = await caught(moveTab(LOC, t3.tabId, { requestId: newRequestId(), expectedVersion: t3.version, tableId: 'mock-t10' }))
    expect(busy.code).toBe('table_has_open_order')
    const moved = await moveTab(LOC, t3.tabId, { requestId: newRequestId(), expectedVersion: t3.version, tableId: 'mock-t4' })
    expect(moved.round).toMatchObject({ kind: 'move', fromLabel: '3', toLabel: '4' })
    expect(moved.tab.tableLabel).toBe('4')
  })

  it('serves the menu with course and station per dish', async () => {
    const menu = await getTabMenu(LOC)
    const pilsner = menu.items.find((i) => i.name === 'Pilsner')!
    expect(pilsner).toMatchObject({ course: 'drinks', stationId: 'bar', alcohol: true })
    expect(menu.items.find((i) => i.name === 'Oxfilé')!.options[0]).toMatchObject({ name: 'Stekgrad', required: true })
  })

  it('makes 32 hex request ids', () => {
    const a = newRequestId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(newRequestId()).not.toBe(a)
  })

  it('says who acts: network for the restaurant, internal errors are Booqys fel', () => {
    const net = tabErrorText(new NetworkError())
    expect(net.who).toBe('restaurant')
    const internal = tabErrorText(new ApiError(500, 'internal', { code: 'internal', fromServer: true }))
    expect(internal.who).toBe('booqy')
    expect(errorInfo(internal.text)?.actor).toBe('booqy')
    const noTables = tabErrorText(new ApiError(409, 'no_tables', { code: 'no_tables', fromServer: true }))
    expect(noTables.text).toContain('Planritning')
    expect(errorInfo(noTables.text)?.link?.to).toBe('/layout')
  })
})
