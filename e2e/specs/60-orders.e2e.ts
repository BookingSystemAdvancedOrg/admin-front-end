import { test, expect, type Page, type Browser } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { pick, valueOf } from '../lib/select'
import { optEnv } from '../lib/env'
import { mail, RUN } from '../lib/data'

/**
 * Online pickup order and QR table order, paid with Stripe's published test
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

test('setup: open today, enable ordering, route drinks to the bar, E2E dishes', async ({ page }) => {
  await page.goto('/installningar#profil')
  await ready(page, 'Inställningar')
  const opens = page.getByLabel(`${today} öppnar`).first()
  const closes = page.getByLabel(`${today} stänger`).first()
  if (!existsSync(RESTORE)) {
    writeFileSync(RESTORE, JSON.stringify({ day: today, opens: await opens.inputValue().catch(() => ''), closes: await closes.inputValue().catch(() => '') }))
  }
  if (!(await opens.count())) await page.locator('.hours-editor-row', { hasText: today }).getByRole('button', { name: '+ Lägg till tid' }).click()
  await page.getByLabel(`${today} öppnar`).first().fill('00:00')
  await page.getByLabel(`${today} stänger`).first().fill('23:59')
  await page.getByRole('button', { name: 'Spara ändringar' }).click()
  await expect(page.locator('.form-error, [role=alert]').filter({ hasText: /tid/ })).toHaveCount(0)
  await page.waitForTimeout(2000)

  await page.goto('/installningar#bestallning')
  await ready(page)
  for (const id of ['ordering-enabled-label', 'ordering-pickup-label', 'ordering-table-label']) {
    const sw = page.locator(`[role=switch][aria-labelledby=${id}]`)
    if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
  }
  const r0 = JSON.parse(readFileSync(RESTORE, 'utf8'))
  if (r0.last === undefined) writeFileSync(RESTORE, JSON.stringify({ ...r0, last: await page.getByLabel('Sista beställning (min före stängning)').inputValue() }))
  await page.getByLabel('Sista beställning (min före stängning)').fill('0')
  await page.getByRole('button', { name: 'Spara beställning' }).click()
  await page.waitForTimeout(2000)

  await page.goto('/installningar#skrivare')
  await ready(page)
  const r1 = JSON.parse(readFileSync(RESTORE, 'utf8'))
  if (r1.drinks === undefined) {
    writeFileSync(RESTORE, JSON.stringify({ ...r1, drinks: await valueOf(page.getByLabel('Drycker')), mains: await valueOf(page.getByLabel('Varmrätter')),
      allergy: await page.locator('[role=switch][aria-labelledby=allergy-ticket-label]').getAttribute('aria-checked') }))
  }
  await pick(page.getByLabel('Drycker'), { label: 'Bar' })
  await pick(page.getByLabel('Varmrätter'), { label: 'Kök' })
  const allergy = page.locator('[role=switch][aria-labelledby=allergy-ticket-label]')
  if ((await allergy.getAttribute('aria-checked')) !== 'true') await allergy.click()
  await page.getByRole('button', { name: 'Spara stationer' }).click()
  await page.waitForTimeout(2000)

  await page.goto('/meny')
  await ready(page, 'Meny')
  const dishes: { name: string; cat: string; price: string; alcohol?: boolean; station?: string; parts?: [string, string][] }[] = [
    { name: 'E2E Margherita', cat: 'Varmrätter', price: '120' },
    { name: 'E2E Cola', cat: 'Drycker', price: '30', station: 'Ingen bong' },
    { name: 'E2E Fatöl', cat: 'Drycker', price: '75', alcohol: true },
    { name: 'E2E Pizzameny', cat: 'Varmrätter', price: '149', parts: [['Pizza', 'Kök'], ['Läsk', 'Bar']] },
  ]
  for (const d of dishes) {
    if (await page.getByRole('row', { name: new RegExp(d.name) }).count()) {
      const sw = page.getByRole('switch', { name: `${d.name} aktiv` }).first()
      if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click()
      continue
    }
    await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
    const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
    await dlg.locator('input[type=file]').setInputFiles('fixtures/dish.jpg')
    await dlg.getByLabel('Namn').fill(d.name)
    await pick(dlg.getByLabel('Kategori'), { label: d.cat })
    await dlg.getByLabel('Pris (kr)').fill(d.price)
    if (d.alcohol) await dlg.getByRole('switch', { name: 'Innehåller alkohol' }).click()
    if (d.station) await pick(dlg.locator('#dish-station'), { label: d.station })
    for (const [i, [part, st]] of (d.parts ?? []).entries()) {
      await dlg.getByRole('button', { name: i === 0 ? 'Dela upp som meny/combo' : 'Lägg till del' }).click()
      await dlg.locator(`#dish-part-${i}`).fill(part)
      await pick(dlg.locator(`#dish-part-station-${i}`), { label: st })
    }
    await dlg.getByRole('button', { name: 'Lägg till rätt' }).click()
    await expect(dlg).toBeHidden({ timeout: 30000 })
  }
})

test('guest pickup order with allergy, paid with test card, appears on the board', async ({ page, browser }, info) => {
  const guest = await guestPage(browser)
  const w = watch(guest)
  await guest.goto(`${GUEST}/bestall?restaurang=${SLUG}`)
  await expect(guest.getByRole('heading', { name: /Beställ för avhämtning/ })).toBeVisible({ timeout: 30000 })
  await guest.screenshot({ path: info.outputPath('guest-menu.png') })
  await expect.soft(guest.locator('li', { hasText: 'E2E Fatöl' }).getByText('Bara vid bordet'), 'alcohol only at the table').toBeVisible()
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

test('kitchen screen: food to Kök, combo split, drink part to Bar, cola no ticket, allergy ticket', async ({ page }, info) => {
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
  await page.getByRole('button', { name: /^Bar/ }).or(page.getByRole('tab', { name: /^Bar/ })).first().click()
  await page.waitForTimeout(1500)
  const bar = await page.locator('body').innerText()
  info.annotations.push({ type: 'bar text', description: bar.slice(bar.indexOf('Köksskärm')).replace(/\s+/g, ' ').slice(0, 600) })
  expect.soft(bar, 'combo part Läsk on the Bar station').toMatch(/Läsk/)
  await page.screenshot({ path: info.outputPath('kds-bar.png'), fullPage: true })
  expect.soft(text, 'Cola has no ticket').not.toMatch(/E2E Cola/)
  expect.soft(text, 'allergy shown').toMatch(/[Jj]ordnöt/)
})

test('QR table order: table shown first on the board', async ({ page, browser }, info) => {
  // the table's QR link, from the admin
  const tokenReq = page.waitForRequest((r) => /\/orders\/table-codes/.test(r.url()) && !!r.headers()['authorization'])
  await page.goto('/layout')
  await ready(page, 'Layout')
  await page.getByRole('button', { name: 'QR-koder' }).click()
  const req = await tokenReq.catch(() => null)
  test.skip(!req, 'no published layout with tables on the order-test restaurant')
  const res = await page.request.get(req!.url(), { headers: { authorization: req!.headers()['authorization'] } })
  const codes = (await res.json()).items ?? (await res.json()).codes ?? []
  info.annotations.push({ type: 'table codes', description: JSON.stringify(codes).slice(0, 300) })
  const first = codes[0]
  test.skip(!first, 'no tables')
  const url: string = first.url ?? first.orderUrl ?? ''
  const code = first.code ?? first.key ?? new URL(url).searchParams.get('bord')
  const guest = await guestPage(browser)
  await guest.goto(`${GUEST}/bestall?restaurang=${SLUG}&bord=${encodeURIComponent(code)}`)
  await expect(guest.getByRole('heading', { name: /Beställ till bordet/ })).toBeVisible({ timeout: 30000 })
  await guest.getByRole('button', { name: 'Lägg till E2E Fatöl' }).click()
  await guest.getByRole('button', { name: 'Lägg till E2E Margherita' }).click()
  await checkout(guest, `E2E Bord ${RUN}`)
  await page.goto('/bestallningar')
  await ready(page, 'Beställningar')
  const card = page.locator('article, li, .order-card').filter({ hasText: `E2E Bord ${RUN}` }).first()
  await expect(card).toBeVisible({ timeout: 60000 })
  await page.screenshot({ path: info.outputPath('board-table.png') })
  const t = (await card.innerText()).trim()
  info.annotations.push({ type: 'card text', description: t.slice(0, 200) })
  expect.soft(t.split('\n')[0], 'table is the first thing on the card').toMatch(/Bord|T\d/)
})

test.afterAll('restore: hours back, ordering off, E2E dishes off', async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: '.auth/pizza.json', baseURL: test.info().project.use.baseURL })).newPage()
  if (existsSync(RESTORE)) {
    const r = JSON.parse(readFileSync(RESTORE, 'utf8'))
    await page.goto('/installningar#profil')
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
    await pick(page.getByLabel('Drycker'), r.drinks)
    await pick(page.getByLabel('Varmrätter'), r.mains)
    const al = page.locator('[role=switch][aria-labelledby=allergy-ticket-label]')
    if ((await al.getAttribute('aria-checked')) !== r.allergy) await al.click()
    await page.getByRole('button', { name: 'Spara stationer' }).click()
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
      await page.waitForTimeout(1500)
    }
  }
  unlinkSync(RESTORE)
})
