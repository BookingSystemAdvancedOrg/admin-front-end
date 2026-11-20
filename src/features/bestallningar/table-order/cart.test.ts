import { describe, expect, it } from 'vitest'
import { makeLine, reconcile } from './cart'
import { mockMenu } from './tableOrderMock'

describe('reconcile', () => {
  it('follows new prices and names and drops dishes that left the menu', () => {
    const menu = mockMenu()
    const cola = menu.items.find((i) => i.menuItemId === 'm-cola')!
    const oxfile = menu.items.find((i) => i.menuItemId === 'm-oxfile')!
    const lines = [makeLine(cola, { quantity: 2 }), makeLine(oxfile, { options: [{ group: 'Stekgrad', choice: 'Medium' }] })]
    const next = {
      ...menu,
      items: menu.items
        .filter((i) => i.menuItemId !== 'm-oxfile')
        .map((i) => (i.menuItemId === 'm-cola' ? { ...i, price: i.price + 500, name: 'Coca-Cola' } : i)),
    }
    const out = reconcile(lines, next)
    expect(out.changed).toBe(true)
    expect(out.dropped).toEqual(['Oxfilé'])
    expect(out.lines).toEqual([expect.objectContaining({ menuItemId: 'm-cola', name: 'Coca-Cola', unitPrice: cola.price + 500, quantity: 2 })])
  })

  it('keeps the same array when nothing changed', () => {
    const menu = mockMenu()
    const lines = [makeLine(menu.items[0]!)]
    const out = reconcile(lines, menu)
    expect(out.changed).toBe(false)
    expect(out.lines).toBe(lines)
  })
})
