import { test, expect, type Page, type Browser } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { pick } from '../lib/select'
import { optEnv } from '../lib/env'
import { Api } from '../lib/api'
import { mail, RUN } from '../lib/data'

/**
 * Online pickup order, paid with Stripe's published test
 * card on the guest site served from localhost (customer-front-end, real dev
 * API), then seen on the orders board and the kitchen screen (KDS).
 *
 * Needs a restaurant whose Stripe account is ready: E2E_ORDER_SLUG (default
 * test-pizza) and an owner login for it (E2E_PIZZA_OWNER_*). The test opens
 * ordering and today's hours for the run and restores them afterwards.
 */
const SLUG = optEnv('E2E_ORDER_SLUG') ?? 'test-pizza'
const GUEST = optEnv('E2E_GUEST_LOCAL_URL') ?? 'http://localhost:7181'
const RESTORE = '.auth/order-restore.json'
const DAYS = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag']
const today = DAYS[new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Stockholm' })).getDay()]

test.use({ storageState: '.auth/pizza.json' })
test.describe.configure({ mode: 'default' })
test.skip(!optEnv('E2E_PIZZA_OWNER_EMAIL'), 'no Stripe-ready order-test restaurant configured')

async function guestPage(browser: Browser) {
  const ctx = await browser.newContext({ locale: 'sv-SE', timezoneId: 'Europe/Stockholm', viewport: { width: 1280, height: 900 } })
  return ctx.newPage()
}

async function payWithTestCard(page: Page) {
  const frame = page.frameLocator('iframe[title*="Secure payment"], iframe[name^="__privateStripeFrame"]').first()
  await expect(frame.locator('input[name=number]')).toBeVisible({ timeout: 30000 })
  await frame.locator('input[name=number]').fill('4242424242424242')
  await frame.locator('input[name=expiry]').fill('12 / 34')
  await frame.locator('input[name=cvc]').fill('123')
  const zip = frame.locator('input[name=postalCode]')
  if (await zip.isVisible().catch(() => false)) await zip.fill('11122')
}

async function checkout(page: Page, name: string) {
  const cta = page.locator('.checkout-cta button, button.checkout-next').first()
  await cta.click() // cart -> who
  await page.getByLabel('Namn').fill(name)
  await page.locator('.booking-field', { hasText: 'Mobilnummer' }).locator('input').last().fill('070-174 06 05')
  await cta.click() // -> receipt
  await page.getByLabel('E-post').fill(mail('order'))
  await page.getByLabel('Allergier eller önskemål').fill('E2E: jordnötsallergi, inga nötter')
  await cta.click() // -> confirm
  await page.getByRole('checkbox', { name: /Jag förstår att beställningen/ }).check()
  await page.waitForTimeout(2500) // turnstile (Cloudflare's always-pass dev key)
  await cta.click() // -> payment
  await payWithTestCard(page)
  await cta.click() // pay
  await expect(page).toHaveURL(/\/bestallning\//, { timeout: 60000 })
}

/** The printer a category is sent to (Inställningar, Kvittoskrivare, Vad skickas vart?): one tap saves. */
async function send(page: Page, category: string, to: string) {
  const radio = page.getByRole('radiogroup', { name: `${category} skickas till` }).getByRole('radio', { name: to, exact: true })
  if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click()
  await page.waitForTimeout(800)
}

async function chosen(page: Page, category: string): Promise<string | null> {
  const on = page.getByRole('radiogroup', { name: `${category} skickas till` }).locator('[role=radio][aria-checked=true]')
  return (await on.count()) ? (await on.first().innerText()).trim() : null
}

test('setup: open today, enable ordering, route drinks to the bar, E2E dishes', async ({ page }) => {
  await page.goto('/installningar#dagar')
  await ready(page, 'Inställningar')
  const opens = page.getByLabel(`${today} öppnar`).first()
  const closes = page.getByLabel(`${today} stänger`).first()
  if (!existsSync(RESTORE)) {
    writeFileSync(RESTORE, JSON.stringify({ day: today, opens: await opens.inputValue().catch(() => ''), closes: await closes.inputValue().catch(() => '') }))
  }
  if (!(await opens.count())) await page.locator('.hours-editor-row', { hasText: today }).getByRole('button', { name: 'Lägg till tid' }).click()
  await page.getByLabel(`${today} öppnar`).first().fill('00:00')
  await page.getByLabel(`${today} stänger`).first().fill('23:59')
  await page.getByRole('button', { name: 'Spara ändringar' }).click()
  await expect(page.locator('.form-error, [role=alert]').filter({ hasText: /tid/ })).toHaveCount(0)
  await page.waitForTimeout(2000)

  await page.goto('/installningar#bestallning')
  await ready(page)
  const on = page.locator('[role=switch][aria-labelledby=ordering-enabled-label]')
  if ((await on.getAttribute('aria-checked')) !== 'true') await on.click()
  const r0 = JSON.parse(readFileSync(RESTORE, 'utf8'))
  if (r0.last === undefined) writeFileSync(RESTORE, JSON.stringify({ ...r0, last: await page.getByLabel('Sista beställning (min före stängning)').inputValue() }))
  await page.getByLabel('Sista beställning (min före stängning)').fill('0')
  await page.getByRole('button', { name: 'Spara beställning' }).click()
  await page.waitForTimeout(2000)

  await page.goto('/installningar#skrivare')
  await ready(page)
  const r1 = JSON.parse(readFileSync(RESTORE, 'utf8'))
  await page.getByText('Mer inställningar').click()
  const allergy = page.locator('[role=switch][aria-labelledby=print-allergy-label]')
  if (r1.drinks === undefined) {
    writeFileSync(RESTORE, JSON.stringify({ ...r1, drinks: await chosen(page, 'Drycker'), mains: await chosen(page, 'Varmrätter'),
      allergy: await allergy.getAttribute('aria-checked') }))
  }
  await send(page, 'Drycker', 'Dryck')
  await send(page, 'Varmrätter', 'Kök')
  if ((await allergy.getAttribute('aria-checked')) !== 'true') await allergy.click()
  await page.waitForTimeout(2000)

  await page.goto('/meny')
  await ready(page, 'Meny')
  const dishes: { name: string; cat: string; price: string; alcohol?: boolean; station?: string; parts?: [string, string][] }[] = [
    { name: 'E2E Margherita', cat: 'Varmrätter', price: '120' },
    { name: 'E2E Cola', cat: 'Drycker', price: '30', station: 'Ingen bong' },
    { name: 'E2E Fatöl', cat: 'Drycker', price: '75', alcohol: true },
    { name: 'E2E Pizzameny', cat: 'Varmrätter', price: '149', parts: [['Pizza', 'Kök'], ['Läsk', 'Dryck']] },
  ]
  for (const d of dishes) {
    if (await page.getByRole('row', { name: new RegExp(d.name) }).count()) {
      const sw = page.getByRole('switch', { name: `${d.name} aktiv` }).first()
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
      continue
    }
    await page.getByRole('button', { name: 'Lägg till rätt' }).click()
    const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
    await dlg.locator('input[type=file]').setInputFiles('fixtures/dish.jpg')
    await dlg.getByLabel('Namn').fill(d.name)
    await pick(dlg.getByLabel('Kategori'), { label: d.cat })
    await dlg.getByLabel('Pris (kr)').fill(d.price)
    if (d.alcohol) await dlg.getByRole('switch', { name: 'Innehåller alkohol' }).click()
    if (d.station) await dlg.getByRole('radiogroup', { name: 'Skickas till' }).getByRole('radio', { name: d.station }).click()
    for (const [i, [part, st]] of (d.parts ?? []).entries()) {
      await dlg.getByRole('button', { name: i === 0 ? 'Dela upp som meny/combo' : 'Lägg till del' }).click()
      await dlg.locator(`#dish-part-${i}`).fill(part)
      await pick(dlg.locator(`#dish-part-station-${i}`), { label: st })
    }
    await dlg.getByRole('button', { name: 'Lägg till rätt' }).click()
    await expect(dlg).toBeHidden({ timeout: 30000 })
  }
})

test('setup printers in the UI: simulated Kök, Dryck and Annat, any kind, no old ones left', async ({ page }, info) => {
  const api = await Api.attach(page)
  for (const d of (await (await api.get('/print')).json()).devices as { deviceId: string; name: string }[]) {
    if (/^E2E UI/.test(d.name)) await api.del(`/print/devices/${d.deviceId}`)
  }
  await page.goto('/installningar#skrivare')
  await ready(page)
  for (const [kind, name] of [['Kök', 'E2E UI Kök'], ['Dryck', 'E2E UI Dryck'], ['Annat', 'E2E UI Ugn']] as const) {
    const add = page.getByRole('button', { name: 'Lägg till skrivare' })
    if (await add.count()) await add.click() // after the first printer the form is already open
    const form = page.getByRole('form', { name: 'Ny skrivare' })
    await form.getByRole('radiogroup', { name: 'Sort' }).getByRole('radio', { name: kind }).click()
    await form.locator('#printer-name').fill(name)
    await form.getByText('Simulerad', { exact: true }).click()
    await form.getByRole('button', { name: 'Lägg till', exact: true }).click()
    await expect(page.getByText(name).first(), `${name} card`).toBeVisible({ timeout: 20000 })
  }
  await page.screenshot({ path: info.outputPath('printers.png'), fullPage: true })
  const devices = (await (await api.get('/print')).json()).devices as { name: string; kind: string; simulated?: boolean }[]
  for (const [name, kind] of [['E2E UI Kök', 'kok'], ['E2E UI Dryck', 'dryck'], ['E2E UI Ugn', 'annat']]) {
    const d = devices.find((x) => x.name === name)
    expect(d, name).toBeTruthy()
    expect(d!.kind).toBe(kind)
    expect(d!.simulated, 'simulated printer').toBe(true)
  }
})

test('guest pickup order with allergy, paid with test card, appears on the board', async ({ page, browser }, info) => {
  const guest = await guestPage(browser)
  const w = watch(guest)
  await guest.goto(`${GUEST}/bestall?restaurang=${SLUG}`)
  await expect(guest.getByRole('heading', { name: /Beställ för avhämtning/ })).toBeVisible({ timeout: 30000 })
  await guest.screenshot({ path: info.outputPath('guest-menu.png') })
  await expect.soft(guest.getByRole('button', { name: 'Lägg till E2E Fatöl' }), 'alcohol cannot be ordered online').toHaveCount(0)
  await guest.getByRole('button', { name: 'Lägg till E2E Margherita' }).click()
  await guest.getByRole('button', { name: 'Lägg till E2E Pizzameny' }).click()
  await guest.getByRole('button', { name: 'Lägg till E2E Cola' }).click()
  await guest.locator('.cart-line-notes summary').first().click()
  await guest.locator('[id^=line-allergy-]').first().fill('Jordnötsallergi')
  await checkout(guest, `E2E Gäst ${RUN}`)
  await guest.screenshot({ path: info.outputPath('guest-status.png') })
  await w.attach(info)

  await page.goto('/bestallningar')
  await ready(page, 'Beställningar')
  const card = page.getByText(`E2E Gäst ${RUN}`).first()
  await expect(card).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: info.outputPath('board.png') })
})

test('kitchen screen: food to Kök, combo split, drink part to Dryck, cola no ticket, allergy ticket', async ({ page }, info) => {
  await page.goto('/bestallningar')
  await ready(page, 'Beställningar')
  await page.getByRole('tab', { name: 'Köksskärm' }).click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: info.outputPath('kds.png'), fullPage: true })
  const text = await page.locator('body').innerText()
  info.annotations.push({ type: 'kds text', description: text.replace(/\s+/g, ' ').slice(0, 1500) })
  expect.soft(text, 'Margherita on a kitchen ticket').toMatch(/E2E Margherita/)
  expect.soft(text, 'combo part Pizza').toMatch(/Pizza/)
  expect.soft(text, 'kitchen view does not show the drink part').not.toMatch(/Läsk/)
  await page.getByRole('button', { name: /^(Bar|Dryck)/ }).or(page.getByRole('tab', { name: /^(Bar|Dryck)/ })).first().click()
  await page.waitForTimeout(1500)
  const bar = await page.locator('body').innerText()
  info.annotations.push({ type: 'bar text', description: bar.slice(bar.indexOf('Köksskärm')).replace(/\s+/g, ' ').slice(0, 600) })
  expect.soft(bar, 'combo part Läsk on the Dryck station').toMatch(/Läsk/)
  await page.screenshot({ path: info.outputPath('kds-bar.png'), fullPage: true })
  expect.soft(text, 'Cola has no ticket').not.toMatch(/E2E Cola/)
  expect.soft(text, 'allergy shown').toMatch(/[Jj]ordnöt/)
})

test('the simulated printers printed the order by themselves: food on Kök, drink on Dryck, none crossed', async ({ page }, info) => {
  const api = await Api.attach(page)
  const devices = (await (await api.get('/print')).json()).devices as { deviceId: string; name: string }[]
  const paper = async (name: string) => {
    const d = devices.find((x) => x.name === name)!
    const j = await (await api.get(`/print/devices/${d.deviceId}/simulated`)).json()
    return (j.tickets as { lines: { text: string }[] }[]).map((t) => t.lines.map((l) => l.text).join('\n')).join('\n----\n')
  }
  await page.waitForTimeout(3000)
  const kok = await paper('E2E UI Kök')
  const dryck = await paper('E2E UI Dryck')
  info.annotations.push({ type: 'Kök paper', description: kok.replace(/\n+/g, ' | ').slice(0, 500) })
  info.annotations.push({ type: 'Dryck paper', description: dryck.replace(/\n+/g, ' | ').slice(0, 500) })
  expect(kok, 'food printed on Kök').toMatch(/E2E Margherita/)
  expect(kok, 'no drink on the Kök ticket').not.toMatch(/Läsk|E2E Cola|Fatöl/)
  expect(dryck, 'the drink part printed on Dryck').toMatch(/Läsk/)
  expect(dryck, 'no food on the Dryck ticket').not.toMatch(/E2E Margherita/)
  expect(dryck + kok, 'Cola is set to Ingen bong: on no ticket').not.toMatch(/E2E Cola/)
})

test.afterAll('restore: hours back, ordering off, E2E dishes off', async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: '.auth/pizza.json', baseURL: test.info().project.use.baseURL })).newPage()
  {
    const api = await Api.attach(page)
    for (const d of (await (await api.get('/print')).json()).devices as { deviceId: string; name: string }[]) {
      if (/^E2E UI/.test(d.name)) await api.del(`/print/devices/${d.deviceId}`)
    }
    const st = (await (await api.get('/print')).json()).settings
    if (st?.autoPrint) await api.put('/print/settings', { ...st, autoPrint: false, printerId: null })
  }
  if (existsSync(RESTORE)) {
    const r = JSON.parse(readFileSync(RESTORE, 'utf8'))
    await page.goto('/installningar#dagar')
    await ready(page, 'Inställningar')
    if (r.opens) {
      await page.getByLabel(`${r.day} öppnar`).first().fill(r.opens)
      await page.getByLabel(`${r.day} stänger`).first().fill(r.closes)
    } else {
      await page.getByRole('button', { name: `Ta bort tid för ${r.day}` }).first().click()
    }
    await page.getByRole('button', { name: 'Spara ändringar' }).click()
    await page.waitForTimeout(2000)
  }
  const r = existsSync(RESTORE) ? JSON.parse(readFileSync(RESTORE, 'utf8')) : {}
  if (r.drinks !== undefined) {
    await page.goto('/installningar#skrivare')
    await ready(page)
    if (r.drinks) await send(page, 'Drycker', r.drinks)
    if (r.mains) await send(page, 'Varmrätter', r.mains)
    await page.getByText('Mer inställningar').click()
    const al = page.locator('[role=switch][aria-labelledby=print-allergy-label]')
    if ((await al.getAttribute('aria-checked')) !== r.allergy) await al.click()
    await page.waitForTimeout(1500)
  }
  await page.goto('/installningar#bestallning')
  await ready(page)
  if (r.last !== undefined) await page.getByLabel('Sista beställning (min före stängning)').fill(r.last)
  const sw = page.locator('[role=switch][aria-labelledby=ordering-enabled-label]')
  if ((await sw.getAttribute('aria-checked')) === 'true') await sw.click()
  await page.getByRole('button', { name: 'Spara beställning' }).click()
  await page.waitForTimeout(1500)
  await page.goto('/meny')
  await ready(page, 'Meny')
  page.on('dialog', (d) => d.accept())
  for (const n of ['E2E Margherita', 'E2E Cola', 'E2E Fatöl', 'E2E Pizzameny']) {
    const row = page.getByRole('row', { name: new RegExp(n) }).first()
    if (await row.count()) {
      await row.getByRole('button', { name: 'Radera' }).click()
      await page.getByRole('button', { name: 'Ta bort', exact: true }).click()
      await page.waitForTimeout(1500)
    }
  }
  if (existsSync(RESTORE)) unlinkSync(RESTORE)
})
