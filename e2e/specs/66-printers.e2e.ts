import { test, expect, type Page } from '@playwright/test'
import { optEnv } from '../lib/env'
import { Api } from '../lib/api'

/**
 * Kvittoskrivare on the live dev: simulated printers (protocol "sim", refused in
 * prod) of the kinds Kök, Dryck and Annat, any number; the stations follow the
 * kinds; a pickup order paid with the test card (made by 60-orders) is printed
 * again ("Skriv ut igen") and the tickets land on the right printer: food on
 * Kök, drinks on Dryck, never drinks on Kök unless the category was sent there.
 * Everything made here is removed at the end and the routing is put back.
 */
test.use({ storageState: '.auth/pizza.json' })
test.describe.configure({ mode: 'serial' })
test.skip(!optEnv('E2E_PIZZA_OWNER_EMAIL'), 'no Stripe-ready order-test restaurant configured')

type Device = { deviceId: string; name: string; kind?: string; protocol?: string; simulated?: boolean }
let api: Api
let page: Page
const made: string[] = []

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: '.auth/pizza.json', baseURL: test.info().project.use.baseURL })
  page = await ctx.newPage()
  api = await Api.attach(page)
})

test.afterAll(async () => {
  for (const id of made) await api.del(`/print/devices/${id}`)
  const g = await (await api.get('/print')).json()
  if (g.settings?.autoPrint) await api.put('/print/settings', { ...g.settings, autoPrint: false, printerId: null })
})

async function add(name: string, kind: 'kok' | 'dryck' | 'annat'): Promise<Device> {
  const r = await api.post('/print/devices', { name, protocol: 'sim', kind })
  expect(r.status(), `add ${name}`).toBe(201)
  const d = (await r.json()).device as Device
  made.push(d.deviceId)
  return d
}
const paper = async (d: Device) => {
  const r = await api.get(`/print/devices/${d.deviceId}/simulated`)
  expect(r.status()).toBe(200)
  const j = await r.json()
  return (j.tickets as { lines: { text: string }[] }[]).map((t) => t.lines.map((l) => l.text).join('\n')).join('\n----\n')
}

test('a printer of each kind, any number; the stations follow the kinds', async () => {
  const kok = await add('E2E Köksskrivare', 'kok')
  const dryck = await add('E2E Dryckesskrivare', 'dryck')
  const annat = await add('E2E Pizzaugnen', 'annat')
  const extra = await add('E2E Köksskrivare 2', 'kok') // any number
  const g = await (await api.get('/print')).json()
  const devices = g.devices as Device[]
  for (const d of [kok, dryck, annat, extra]) expect(devices.find((x) => x.deviceId === d.deviceId), d.name).toBeTruthy()
  expect(devices.filter((d) => d.simulated).length).toBeGreaterThanOrEqual(4)
  const st = g.routing.stations as { stationId: string; name: string; kind: string; printerIds: string[] }[]
  const kokSt = st.find((s) => s.stationId === 'kok')!
  expect(kokSt.printerIds, 'Kök station has both kitchen printers').toEqual(expect.arrayContaining([kok.deviceId, extra.deviceId]))
  expect(kokSt.printerIds, 'the drink printer is not on the kitchen station').not.toContain(dryck.deviceId)
  const bar = st.find((s) => s.kind === 'dryck')!
  expect(bar.name).toBe('Dryck')
  expect(bar.printerIds).toContain(dryck.deviceId)
  expect(bar.printerIds).not.toContain(kok.deviceId)
  expect(st.find((s) => s.name === 'E2E Pizzaugnen'), 'an Annat printer is a station named after it').toBeTruthy()
  expect(g.settings.autoPrint, 'the first printer turns auto print on').toBe(true)
  const bad = await api.post('/print/devices', { name: 'E2E fel', protocol: 'sim', kind: 'sushi' })
  expect(bad.status(), 'unknown kind is refused').toBe(400)
})

test('"Skickas till": drinks default to Dryck, never to the kitchen ticket, unless chosen', async () => {
  let r = await api.put('/print/routing/categories', { categories: { drinks: null } })
  expect(r.status()).toBe(200)
  const dflt = await r.json()
  const station = (id: string) => (dflt.stations as { stationId: string; kind: string }[]).find((s) => s.stationId === id)
  const drinks = dflt.categories.drinks as string | null | undefined
  expect(drinks == null || station(drinks)?.kind === 'dryck', `default for drinks is Dryck, got ${drinks}`).toBe(true)
  r = await api.put('/print/routing/categories', { categories: { drinks: 'kok' } })
  expect(r.status(), 'the owner may choose the kitchen for drinks').toBe(200)
  expect((await r.json()).categories.drinks).toBe('kok')
  r = await api.put('/print/routing/categories', { categories: { drinks: 'finns-inte' } })
  expect(r.status(), 'an unknown station is refused').toBe(400)
  r = await api.put('/print/routing/categories', { categories: { drinks: null } })
  expect(r.status()).toBe(200)
})

test('a paid pickup order prints: food on Kök, the drink on Dryck, none crossed', async ({}, info) => {
  const list = await (await api.get('/orders')).json()
  const orders: { orderId: string; customerName?: string; paymentStatus?: string; lines?: { name?: string }[]; items?: { name?: string }[] }[] = list.orders ?? list.items ?? list
  const mine = orders.find((o) => /E2E/.test(o.customerName ?? '') && (o.paymentStatus === 'paid' || o.paymentStatus === 'partly_refunded' || !o.paymentStatus))
  test.skip(!mine, 'no paid E2E order on the board (run 60-orders first)')
  const devs = ((await (await api.get('/print')).json()).devices as Device[]).filter((d) => made.includes(d.deviceId))
  const byName = (n: string) => devs.find((d) => d.name === n)!
  const r = await api.post('/print/jobs', { orderId: mine!.orderId })
  info.annotations.push({ type: 'reprint', description: `${r.status()} ${(await r.text()).slice(0, 200)}` })
  expect([202, 409], 'reprint accepted (409 only for a refunded/cancelled order)').toContain(r.status())
  test.skip(r.status() === 409, 'the E2E order was refunded, nothing to print')
  await page.waitForTimeout(4000)
  const kok = await paper(byName('E2E Köksskrivare'))
  const dryck = await paper(byName('E2E Dryckesskrivare'))
  info.annotations.push({ type: 'Kök paper', description: kok.replace(/\n+/g, ' | ').slice(0, 500) })
  info.annotations.push({ type: 'Dryck paper', description: dryck.replace(/\n+/g, ' | ').slice(0, 500) })
  expect(kok, 'food reached the kitchen printer').toMatch(/Margherita|Pizza/i)
  expect(kok, 'no drink on the kitchen ticket').not.toMatch(/Läsk|Cola|Fatöl/i)
  expect(dryck, 'the drink reached the drink printer').toMatch(/Läsk/i)
  expect(dryck, 'no food on the drink ticket').not.toMatch(/Margherita/i)
})
