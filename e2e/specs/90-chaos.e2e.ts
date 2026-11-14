import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { Api, stockholmDate } from '../lib/api'
import { RUN } from '../lib/data'

test.describe('Chaos', () => {
  test('rapid random clicks across the menu do not crash the app', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/')
    await ready(page, 'Översikt')
    const links = page.getByRole('navigation', { name: 'Huvudmeny' }).getByRole('link')
    const n = await links.count()
    for (let i = 0; i < 40; i++) await links.nth((i * 7) % n).click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(3000)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const pageErrors = w.consoleErrors.filter((e) => e.startsWith('pageerror'))
    await w.attach(info)
    expect(pageErrors, pageErrors.join('\n')).toEqual([])
  })

  test('double-click Boka on a new booking creates one booking', async ({ page }, info) => {
    const api = await Api.attach(page)
    const date = stockholmDate(5)
    await page.getByRole('button', { name: '+ Ny bokning' }).click()
    const dlg = page.getByRole('dialog', { name: 'Ny bokning' })
    await dlg.getByLabel('Antal personer').fill('2')
    await dlg.getByLabel('Datum').fill(date)
    await dlg.getByLabel('Datum').press('Tab')
    await expect(dlg.getByLabel('Tid').locator('option').nth(1)).toBeAttached({ timeout: 20000 })
    await dlg.getByLabel('Tid').selectOption({ index: 3 })
    await dlg.locator('.table-chip').first().click()
    const name = `E2E Dubbelklick ${RUN}${Math.random().toString(36).slice(2, 5)}`
    await dlg.getByLabel('Namn').fill(name)
    await dlg.getByRole('button', { name: 'Boka' }).dblclick()
    await expect(dlg).toBeHidden({ timeout: 20000 })
    const list = await (await api.get(`/reservations?date=${date}`)).json()
    const mine = (list.items ?? []).filter((r: unknown) => JSON.stringify(r).includes(name))
    info.annotations.push({ type: 'bookings created', description: String(mine.length) })
    expect(mine.length).toBe(1)
  })

  test('back/forward and refresh in the middle of a booking form', async ({ page }) => {
    await page.goto('/meny')
    await ready(page, 'Meny')
    await page.goto('/bokningar')
    await ready(page, 'Bokningar')
    await page.getByRole('button', { name: '+ Ny bokning' }).click()
    await page.getByRole('dialog', { name: 'Ny bokning' }).getByLabel('Namn').fill('E2E Halvfärdig')
    await page.goBack()
    await expect(page).toHaveURL(/\/meny/)
    await page.goForward()
    await ready(page, 'Bokningar')
    await page.getByRole('button', { name: '+ Ny bokning' }).click()
    await page.reload()
    await ready(page, 'Bokningar')
    await expect(page.getByRole('heading', { level: 1, name: 'Bokningar' })).toBeVisible()
  })

  test('two tabs edit the same dish: last save wins or a conflict is shown', async ({ page, context }, info) => {
    const a = page
    const b = await context.newPage()
    for (const p of [a, b]) {
      await p.goto('/meny')
      await ready(p, 'Meny')
      await p.getByRole('row', { name: /E2E Toast Skagen/ }).first().click()
    }
    await a.getByRole('dialog').getByLabel('Pris (kr)').fill('151')
    await b.getByRole('dialog').getByLabel('Pris (kr)').fill('152')
    await a.getByRole('dialog').getByRole('button', { name: 'Spara ändringar' }).click()
    await expect(a.getByRole('dialog')).toBeHidden({ timeout: 20000 })
    await b.getByRole('dialog').getByRole('button', { name: 'Spara ändringar' }).click()
    await b.waitForTimeout(3000)
    const conflict = await b.getByRole('dialog').isVisible()
    info.annotations.push({ type: 'second save', description: conflict ? `kept open: ${(await b.getByRole('dialog').locator('.form-error, [role=alert]').allInnerTexts()).join(' ')}` : 'saved over the first (last write wins, no warning)' })
    await a.reload()
    await ready(a, 'Meny')
    info.annotations.push({ type: 'final price', description: (await a.getByRole('row', { name: /E2E Toast Skagen/ }).first().innerText()).replace(/\s+/g, ' ') })
  })

  test('slow 3G: pages still load with a loading animation', async ({ page }, info) => {
    test.skip(test.info().project.use.browserName !== 'chromium' && test.info().project.name !== 'chromium', 'CDP throttling is Chromium only')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 20 * 1024 })
    const t0 = Date.now()
    await page.goto('/bokningar', { timeout: 120000 })
    const sawLoader = await page.locator('.printing, [aria-busy=true], .skeleton, [class*=skel]').first().isVisible({ timeout: 10000 }).catch(() => false)
    await ready(page, 'Bokningar')
    info.annotations.push({ type: 'slow load', description: `${Date.now() - t0} ms, loader seen: ${sawLoader}` })
    expect.soft(sawLoader, 'a loading animation is shown while slow').toBe(true)
  })

  test('offline then online: save fails clearly, then works', async ({ page, context }, info) => {
    await page.goto('/meny')
    await ready(page, 'Meny')
    await page.getByRole('row', { name: /E2E Toast Skagen/ }).first().click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Pris (kr)').fill('153')
    await context.setOffline(true)
    await dlg.getByRole('button', { name: 'Spara ändringar' }).click()
    await page.waitForTimeout(5000)
    const err = await page.locator('.form-error, [role=alert], .toast').allInnerTexts()
    info.annotations.push({ type: 'offline message', description: err.join(' | ') || '(none)' })
    expect.soft(err.join(' '), 'a clear offline / network message').toMatch(/nät|internet|anslutning|offline|uppkoppling/i)
    await context.setOffline(false)
    if (await dlg.isVisible()) await dlg.getByRole('button', { name: 'Spara ändringar' }).click()
    await expect(dlg).toBeHidden({ timeout: 30000 })
  })
})
