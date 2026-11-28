import { test, expect, type Page } from '@playwright/test'
import { pick } from '../lib/select'

/**
 * Work flows on mock data (VITE_API_BASE_URL unset, mock login): what an owner
 * can do in bookings, orders, catering and marketing without an API. Writes the
 * mock layer supports are driven to the end; the rest must fail in place, never
 * crash the page. Phone (390) and desktop (1280).
 */
const SIZES = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 800 },
]

async function open(page: Page, path: string, size: (typeof SIZES)[number]) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.clock.setFixedTime(new Date('2026-11-14T10:00:00+01:00'))
  await page.addInitScript(() => sessionStorage.setItem('admin-mock-session', 'test@test.se'))
  await page.goto(path)
  await page.waitForSelector('.admin-shell', { timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  const skip = page.locator('.guide-skip')
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await expect(page.locator('.printing')).toHaveCount(0, { timeout: 15000 })
  return errors
}

for (const size of SIZES) {
  test.describe(`flows ${size.name}`, () => {
    test(`bookings: change the party size and the booking stays in the list ${size.name}`, async ({ page }) => {
      const errors = await open(page, '/bokningar', size)
      const listRow = page.locator('tr.booking-row').filter({ hasText: 'Sara Ek' })
      await expect(listRow).toHaveCount(1)
      await expect(listRow.locator('.bk-pers')).toHaveText('6')
      await listRow.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('6 pers')
      await dialog.getByRole('button', { name: 'Ändra', exact: true }).click()
      await dialog.getByLabel('Antal personer').fill('8')
      await dialog.getByRole('button', { name: 'Spara', exact: true }).click()
      await expect(dialog).toContainText('8 pers')
      // The guest got no message (mock): the staff confirm they told them.
      await expect(dialog.getByRole('region', { name: 'Säg till gästen' })).toContainText('8 personer')
      await dialog.getByRole('button', { name: 'Klart', exact: true }).click()
      await dialog.getByRole('button', { name: 'Stäng', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      // Still listed on the same day, and the list row itself shows the new party size.
      await expect(listRow).toHaveCount(1)
      await expect(listRow.locator('.bk-pers')).toHaveText('8')
      expect(errors).toEqual([])
    })

    test(`bookings: a status change without an API fails in place ${size.name}`, async ({ page }) => {
      const errors = await open(page, '/bokningar', size)
      await page.getByText('Johan Lind', { exact: true }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Anlänt', exact: true }).click()
      await expect(dialog.getByText(/mockdata/)).toBeVisible()
      // The status badge itself still says Bokad: nothing changed.
      await expect(dialog.locator('.status-badge')).toHaveText('Bokad')
      expect(errors).toEqual([])
    })

    test(`orders: partial refund shows on the order ${size.name}`, async ({ page }) => {
      const errors = await open(page, '/bestallningar', size)
      const card = page.locator('article.order-card').filter({ hasText: '#12' }).filter({ hasText: 'Åsa Öberg' })
      await expect(card).toHaveCount(1)
      await card.getByRole('button', { name: 'Återbetala', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('Kvar att återbetala 460 kr')
      await dialog.getByLabel('Belopp (kr)').fill('100')
      await dialog.getByRole('button', { name: 'Återbetala 100 kr' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(card.getByText(/Delvis återbetald 100 kr/)).toBeVisible()
      expect(errors).toEqual([])
    })

    test(`catering: open a request and build the offer from the menu ${size.name}`, async ({ page }) => {
      const errors = await open(page, '/catering', size)
      await page.getByRole('link', { name: 'Öppna' }).first().click()
      await expect(page.getByText('Erik Berg').first()).toBeVisible()
      // No org number in the data: no empty "()" after the company name.
      await expect(page.getByText('Berg & Co', { exact: true })).toBeVisible()
      await expect(page.getByText('Berg & Co ()')).toHaveCount(0)
      const next = page.getByRole('button', { name: 'Nästa: signera' })
      await expect(next).toBeDisabled()
      await pick(page.getByRole('combobox', { name: 'Lägg till från cateringmenyn' }), { index: 1 })
      await expect(next).toBeEnabled()
      await expect(page.locator('.offer-totals, .offer-sum, main').getByText(/Totalt inkl\. moms/).first()).toBeVisible()
      expect(errors).toEqual([])
    })

    test(`marketing: locked on the mock plan, with the way to the subscription ${size.name}`, async ({ page }) => {
      const errors = await open(page, '/marknadsforing', size)
      await expect(page.getByText('Ingår inte i er plan')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Se abonnemanget' }).or(page.getByRole('button', { name: 'Se abonnemanget' }))).toBeVisible()
      expect(errors).toEqual([])
    })
  })
}
