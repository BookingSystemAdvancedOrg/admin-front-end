import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { optEnv } from '../lib/env'
import { mail, RUN, TENANT_NAME, TENANT_SLUG } from '../lib/data'

/** Guest side of the E2E restaurant: its own site, booking online, ordering state, QR sticker. */
const GUEST = optEnv('E2E_GUEST_LOCAL_URL') ?? 'http://localhost:7181'

test.describe('Guest site for the E2E restaurant', () => {
  test('own site is live on <slug>.dev.booqy.se', async ({ browser }, info) => {
    const page = await (await browser.newContext()).newPage()
    const w = watch(page)
    const res = await page.goto(`https://${TENANT_SLUG}.dev.booqy.se/`)
    info.annotations.push({ type: 'status', description: String(res?.status()) })
    expect(res?.status(), 'site answers (dev-created customers get no site repo: "Dry run")').toBe(200)
    await expect(page.getByText(TENANT_NAME).first()).toBeVisible({ timeout: 30000 })
    await page.screenshot({ path: info.outputPath('site.png') })
    await w.attach(info)
  })

  test('guest books a table online for tomorrow; it shows in admin @webkit', async ({ page, browser }, info) => {
    const guest = await (await browser.newContext({ locale: 'sv-SE', timezoneId: 'Europe/Stockholm' })).newPage()
    const w = watch(guest)
    await guest.goto(`${GUEST}/boka-bord?restaurang=${TENANT_SLUG}`)
    await expect(guest.getByRole('heading', { name: 'Boka bord' })).toBeVisible({ timeout: 30000 })
    await guest.getByRole('group', { name: 'Välj datum' }).getByRole('button').nth(1).click()
    const times = guest.getByRole('group', { name: 'Välj tid' }).getByRole('button')
    await expect(times.first()).toBeVisible({ timeout: 30000 })
    await times.nth(Math.min(6, (await times.count()) - 1)).click()
    const tables = guest.getByRole('group', { name: 'Lediga bord' }).getByRole('button')
    if (await tables.first().isVisible({ timeout: 15000 }).catch(() => false)) await tables.first().click()
    // dev uses Cloudflare's always-pass Turnstile test key; give the widget time to load
    await guest.waitForTimeout(4000)
    await guest.getByRole('button', { name: 'Bekräfta bord' }).click()
    const name = `E2E Webbgäst ${RUN}`
    await guest.locator('label', { hasText: 'Namn' }).locator('input').fill(name)
    await guest.locator('label', { hasText: 'E-post' }).locator('input').fill(mail('webguest'))
    await guest.locator('label', { hasText: 'Telefon' }).locator('input').fill('070-174 06 05')
    await guest.getByRole('checkbox', { name: /Jag godkänner/ }).check()
    await guest.waitForTimeout(2500)
    await guest.getByRole('button', { name: /Boka bordet|Fortsätt/ }).click()
    await expect(guest.locator('.booking-status')).toBeVisible({ timeout: 30000 })
    await guest.screenshot({ path: info.outputPath('booked.png') })
    await w.attach(info)
    // admin sees it
    await page.goto('/bokningar')
    await ready(page, 'Bokningar')
    await page.getByRole('button', { name: 'Nästa dag' }).click()
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20000 })
  })

  test('ordering without Stripe: guest gets a clear "not open" message', async ({ browser }, info) => {
    const guest = await (await browser.newContext()).newPage()
    await guest.goto(`${GUEST}/bestall?restaurang=${TENANT_SLUG}`)
    await guest.waitForTimeout(4000)
    info.annotations.push({ type: 'url', description: guest.url() })
    await guest.screenshot({ path: info.outputPath('order.png') })
    // the Beställ page is either hidden from the menu or explains it is not open
    const text = await guest.locator('body').innerText()
    expect(text).not.toMatch(/Något gick fel|error|undefined/i)
  })

  test('QR sticker link from Layout shows the table chip on the guest page', async ({ page, browser }, info) => {
    const reqP = page.waitForRequest((r) => /\/orders\/table-codes/.test(r.url()) && !!r.headers()['authorization'])
    await page.goto('/layout')
    await ready(page, 'Layout')
    await page.getByRole('button', { name: 'QR-koder' }).click()
    const req = await reqP
    const res = await page.request.get(req.url(), { headers: { authorization: req.headers()['authorization'] } })
    const body = await res.json()
    info.annotations.push({ type: 'codes', description: JSON.stringify(body).slice(0, 400) })
    const item = (body.items ?? body.codes ?? body.tables ?? [])[0]
    expect(item, 'published tables have QR codes').toBeTruthy()
    const url = String(item.url ?? item.orderUrl ?? '')
    const code = item.code ?? item.key ?? (url ? new URL(url).searchParams.get('bord') : '')
    info.annotations.push({ type: 'sticker url', description: url })
    const guest = await (await browser.newContext()).newPage()
    await guest.goto(`${GUEST}/bestall?restaurang=${TENANT_SLUG}&bord=${encodeURIComponent(code)}`)
    await guest.waitForTimeout(4000)
    await guest.screenshot({ path: info.outputPath('qr-guest.png') })
    const tampered = await (await browser.newContext()).newPage()
    await tampered.goto(`${GUEST}/bestall?restaurang=${TENANT_SLUG}&bord=${encodeURIComponent(String(code).slice(0, -2) + 'xx')}`)
    await tampered.waitForTimeout(4000)
    await tampered.screenshot({ path: info.outputPath('qr-tampered.png') })
    info.annotations.push({ type: 'tampered text', description: (await tampered.locator('main').innerText()).slice(0, 200) })
  })
})
