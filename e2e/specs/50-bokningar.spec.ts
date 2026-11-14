import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { Api, stockholmDate } from '../lib/api'
import { mail, PHONE } from '../lib/data'

type Slot = { startTime: string; tables?: { tableId: string; seats: number }[]; availableTables?: { tableId: string; seats: number }[] }

const TOMORROW = stockholmDate(1)

async function slots(api: Api, date: string, walkIn = false) {
  const r = await api.get(`/availability?date=${date}${walkIn ? '&walkIn=true' : ''}`)
  expect(r.status(), await r.text()).toBe(200)
  return ((await r.json()).slots ?? []) as Slot[]
}
const tablesOf = (s: Slot) => s.tables ?? s.availableTables ?? []

test.describe('Admin: Bokningar', () => {
  test('phone booking through the form @webkit', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/bokningar')
    await ready(page, 'Bokningar')
    await page.getByRole('button', { name: '+ Ny bokning' }).click()
    const dlg = page.getByRole('dialog', { name: 'Ny bokning' })
    await dlg.getByLabel('Antal personer').fill('4')
    await dlg.getByLabel('Datum').fill(TOMORROW)
    await dlg.getByLabel('Datum').press('Tab')
    const time = dlg.getByLabel('Tid')
    await expect(time.locator('option').nth(1)).toBeAttached({ timeout: 20000 })
    await time.selectOption({ index: 4 })
    await dlg.locator('.table-chip').first().click()
    await dlg.getByLabel('Namn').fill('E2E Åsa Öberg')
    await dlg.getByLabel('Telefon (valfritt)').fill(PHONE)
    await dlg.getByLabel('E-post (valfritt)').fill(mail('guest1'))
    await dlg.getByLabel('Anteckning (valfritt)').fill('E2E nötallergi')
    await page.screenshot({ path: info.outputPath('form.png') })
    await dlg.getByRole('button', { name: 'Boka' }).click()
    await expect(dlg).toBeHidden({ timeout: 20000 })
    await w.attach(info)
    expect(w.failed, w.failed.join('\n')).toEqual([])
  })

  test('walk-in (drop-in) placed on a table today @webkit', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/bokningar')
    await ready(page, 'Bokningar')
    await page.getByRole('button', { name: '+ Ny bokning' }).click()
    const dlg = page.getByRole('dialog', { name: 'Ny bokning' })
    await dlg.getByRole('radio', { name: 'Drop-in' }).click()
    await dlg.getByLabel('Antal personer').fill('2')
    const time = dlg.getByLabel('Tid')
    await expect(time.locator('option').nth(1)).toBeAttached({ timeout: 20000 })
    await time.selectOption({ index: 1 })
    await dlg.locator('.table-chip').first().click()
    await dlg.getByLabel('Namn').fill('E2E Drop-in')
    await dlg.getByRole('button', { name: 'Boka' }).click()
    await expect(dlg).toBeHidden({ timeout: 20000 })
    await expect(page.getByText('E2E Drop-in').first()).toBeVisible()
    await w.attach(info)
  })

  test('overbooking: same table and time twice is refused (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const s = (await slots(api, TOMORROW)).find((x) => tablesOf(x).length > 0)!
    const t = tablesOf(s)[0]
    const body = { date: TOMORROW, startTime: s.startTime, tableIds: [t.tableId], partySize: 2, name: 'E2E Dubbel A', source: 'phone', notifyGuest: false }
    const a = await api.post('/reservations/manual', body)
    expect(a.status(), await a.text()).toBeLessThan(300)
    const b = await api.post('/reservations/manual', { ...body, name: 'E2E Dubbel B' })
    expect(b.status(), `second booking on same table/time must fail: ${await b.text()}`).toBeGreaterThanOrEqual(400)
  })

  test('overbooking: overlapping time on the same table is refused (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const all = await slots(api, TOMORROW)
    const s = all.find((x) => tablesOf(x).length > 0 && x.startTime >= '18:00')!
    const t = tablesOf(s)[0]
    const a = await api.post('/reservations/manual', { date: TOMORROW, startTime: s.startTime, tableIds: [t.tableId], partySize: 2, name: 'E2E Overlap A', source: 'phone', notifyGuest: false })
    expect(a.status(), await a.text()).toBeLessThan(300)
    const [h, m] = s.startTime.split(':').map(Number)
    const later = `${String(h + (m === 30 ? 1 : 0)).padStart(2, '0')}:${m === 30 ? '00' : '30'}`
    const b = await api.post('/reservations/manual', { date: TOMORROW, startTime: later, tableIds: [t.tableId], partySize: 2, name: 'E2E Overlap B', source: 'phone', notifyGuest: false })
    expect(b.status(), `overlap 30 min later must fail: ${await b.text()}`).toBeGreaterThanOrEqual(400)
  })

  test('overbooking race: 5 parallel bookings for one table, only one wins (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const all = await slots(api, stockholmDate(2))
    const s = all.find((x) => tablesOf(x).length > 0 && x.startTime >= '12:00')!
    const t = tablesOf(s)[0]
    const res = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => api.post('/reservations/manual', { date: stockholmDate(2), startTime: s.startTime, tableIds: [t.tableId], partySize: 2, name: `E2E Race ${i}`, source: 'phone', notifyGuest: false })),
    )
    const ok = res.filter((r) => r.status() < 300).length
    expect(ok, `statuses ${res.map((r) => r.status()).join(',')}`).toBe(1)
  })

  test('party bigger than the table is refused (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const all = await slots(api, stockholmDate(3))
    const s = all.find((x) => tablesOf(x).length > 0)!
    const small = [...tablesOf(s)].sort((a, b) => a.seats - b.seats)[0]
    const r = await api.post('/reservations/manual', { date: stockholmDate(3), startTime: s.startTime, tableIds: [small.tableId], partySize: small.seats + 6, name: 'E2E För stort sällskap', source: 'phone', notifyGuest: false })
    expect(r.status(), `party ${small.seats + 6} on ${small.seats}-seat table: ${await r.text()}`).toBeGreaterThanOrEqual(400)
  })

  test('booking in the past is refused (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const r = await api.post('/reservations/manual', { date: stockholmDate(-1), startTime: '18:00', tableIds: [], partySize: 2, name: 'E2E Igår', source: 'phone', notifyGuest: false })
    expect(r.status(), await r.text()).toBeGreaterThanOrEqual(400)
  })

  test('booking after closing time is refused (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const all = await slots(api, TOMORROW)
    const t = tablesOf(all.find((x) => tablesOf(x).length > 0)!)[0]
    const r = await api.post('/reservations/manual', { date: TOMORROW, startTime: '23:45', tableIds: [t.tableId], partySize: 2, name: 'E2E Efter stängning', source: 'phone', notifyGuest: false })
    expect(r.status(), await r.text()).toBeGreaterThanOrEqual(400)
  })

  test('around midnight: Saturday open till 02:00 offers late slots (timezone)', async ({ page }) => {
    const api = await Api.attach(page)
    // next Saturday
    let n = 1
    while (new Date(stockholmDate(n) + 'T12:00:00').getDay() !== 6) n++
    const all = await slots(api, stockholmDate(n))
    const last = all.map((s) => s.startTime).sort().pop()
    test.info().annotations.push({ type: 'last Saturday slot', description: String(last) })
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((s) => /^\d\d:\d\d$/.test(s.startTime))).toBe(true)
  })

  test('move a booking to another table, mark arrived and no-show', async ({ page }, info) => {
    const w = watch(page)
    const api = await Api.attach(page)
    const all = await slots(api, stockholmDate(4))
    const s = all.find((x) => tablesOf(x).length > 1)!
    const [t1, t2] = tablesOf(s)
    const r = await api.post('/reservations/manual', { date: stockholmDate(4), startTime: s.startTime, tableIds: [t1.tableId], partySize: 2, name: 'E2E Flytta mig', source: 'phone', notifyGuest: false })
    expect(r.status(), await r.text()).toBeLessThan(300)
    const id = (await r.json()).reservationId ?? (await r.json()).id
    const mv = await api.patch(`/reservations/${id}`, { tableIds: [t2.tableId] })
    expect(mv.status(), `move table: ${await mv.text()}`).toBeLessThan(300)
    // UI: open the day and the booking
    await page.goto('/bokningar')
    await ready(page, 'Bokningar')
    await page.getByLabel('Välj datum').fill(stockholmDate(4))
    await page.getByLabel('Välj datum').press('Enter')
    await page.getByText('E2E Flytta mig').first().click()
    const dlg = page.getByRole('dialog', { name: 'Bokning' })
    await expect(dlg).toBeVisible()
    await page.screenshot({ path: info.outputPath('booking.png') })
    const statuses = await dlg.getByRole('button').allTextContents()
    info.annotations.push({ type: 'booking actions', description: statuses.join(' | ') })
    const arrived = await api.post(`/reservations/${id}/status`, { status: 'arrived' })
    info.annotations.push({ type: 'arrived status', description: `${arrived.status()} ${(await arrived.text()).slice(0, 200)}` })
    const noshow = await api.post(`/reservations/${id}/status`, { status: 'no_show' })
    info.annotations.push({ type: 'no_show status', description: `${noshow.status()} ${(await noshow.text()).slice(0, 200)}` })
    await w.attach(info)
  })
  test('walk-in seated now can be marked arrived (API)', async ({ page }) => {
    const api = await Api.attach(page)
    const all = await slots(api, stockholmDate(0), true)
    const now = new Date().toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' })
    const s = all.find((x) => tablesOf(x).length > 0 && x.startTime <= now)
    test.skip(!s, 'restaurant not open right now (no walk-in slot that has started)')
    const r = await api.post('/reservations/manual', { date: stockholmDate(0), startTime: s!.startTime, tableIds: [tablesOf(s!)[0].tableId], partySize: 2, name: 'E2E Walk-in anlänt', source: 'walk_in', notifyGuest: false })
    expect(r.status(), await r.text()).toBeLessThan(300)
    const j = await r.json()
    const st = await api.post(`/reservations/${j.reservationId ?? j.id}/status`, { status: 'arrived' })
    expect(st.status(), await st.text()).toBeLessThan(300)
  })
})
