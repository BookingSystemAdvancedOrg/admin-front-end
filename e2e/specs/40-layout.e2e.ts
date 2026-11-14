import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'

/** Draws 4 square tables with the tool (each lands on a free spot; the first is set to
 * 2 seats) and publishes the layout. Bookings and QR orders use it. */
test.describe('Admin: Layout', () => {
  test('draw tables, publish, QR codes', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/layout')
    await ready(page, 'Layout')
    await page.getByRole('button', { name: '2D', exact: true }).click()
    await page.waitForTimeout(2000)
    const tables = page.locator('.floor-scene .table-el')
    const overlapping = page.locator('.floor-scene .table-el.overlap')
    if ((await overlapping.count()) > 0 || (await tables.count()) < 4) {
      // Tables on top of each other can no longer be published (layouts drawn
      // before that check had them): start the floor over.
      if (await tables.count()) {
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.press('Delete')
        await expect(tables).toHaveCount(0)
      }
      for (let i = 0; i < 4; i++) {
        // A click on the tool puts the table on the nearest free spot.
        await page.getByRole('button', { name: /^Fyrkant/ }).click()
        await page.waitForTimeout(300)
        if (i === 0) {
          // first table: 2 seats (for the "party too big" test)
          const seats = page.locator('.seats-stepper').first()
          await expect(seats).toBeVisible()
          for (let k = 0; k < 6 && Number(await seats.locator('span').textContent()) > 2; k++) {
            await seats.getByRole('button', { name: '-' }).click()
          }
        }
      }
      await expect(tables).toHaveCount(4)
    }
    await expect(overlapping, 'new tables never land on top of each other').toHaveCount(0)
    await page.screenshot({ path: info.outputPath('drawn.png') })
    await page.getByRole('button', { name: 'Publicera layout' }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /Publicera/ })
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click()
    const done = page.getByText(/Publicerad och aktiverad|Publicerad som version|är publicerad men inte aktiverad/).first()
    await expect(done).toBeVisible({ timeout: 30000 })
    info.annotations.push({ type: 'publish result', description: (await done.textContent()) ?? '' })
    // First publish activates at once; later ones switch over at a scheduled time (by design).
    // While a switch is already booked a new version is published but not activated, and the
    // page says so (it used to claim "Publicerad" while the version stayed inactive).
    expect(await done.textContent()).toMatch(/aktiverad som version|bytet sker|versionsbyte är redan inbokat/)
    await page.getByRole('button', { name: 'QR-koder' }).click()
    const qr = page.getByRole('dialog')
    await expect(qr).toBeVisible()
    await expect(qr.locator('svg, img, canvas').first()).toBeVisible({ timeout: 20000 })
    await page.screenshot({ path: info.outputPath('qr.png') })
    await w.attach(info)
  })

  test('Kassa is gone from the layout editor', async ({ page }) => {
    await page.goto('/layout')
    await ready(page, 'Layout')
    await expect.soft(page.getByRole('button', { name: /kassa/i }), 'no "Placera kassan / Kassa" tool').toHaveCount(0)
  })
})
