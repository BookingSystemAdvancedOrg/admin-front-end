import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'

/** Draws 4 square tables (2, 4, 4, 6 seats would be ideal; default seats are used and the
 * first is set to 2) and publishes the layout. Bookings and QR orders use it. */
test.describe('Admin: Layout', () => {
  test('draw tables, publish, QR codes', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/layout')
    await ready(page, 'Layout')
    await page.waitForTimeout(2000)
    const existing = (await page.getByText(/Gäller: Version/).count()) ? 99 : 0
    await page.getByRole('button', { name: '2D', exact: true }).click()
    const scene = page.locator('.floor-scene')
    const box = (await scene.boundingBox())!
    if (existing < 4) {
      for (const [fx, fy] of [[0.2, 0.25], [0.7, 0.25], [0.2, 0.75], [0.7, 0.75]]) {
        await page.getByRole('button', { name: /^Fyrkantigt bord/ }).click()
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
        await page.waitForTimeout(300)
      }
    }
    await page.screenshot({ path: info.outputPath('drawn.png') })
    // first table: 2 seats (for the "party too big" test)
    await page.getByRole('button', { name: /^Välj, flytta/ }).click()
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.25)
    const seats = page.locator('.seats-stepper')
    if (await seats.isVisible()) {
      for (let i = 0; i < 6; i++) {
        const t = Number(await seats.locator('span').textContent())
        if (t <= 2) break
        await seats.getByRole('button', { name: '-' }).click()
      }
    }
    await page.getByRole('button', { name: 'Publicera layout' }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /Publicera/ })
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click()
    const done = page.getByText(/Publicerad och aktiverad|Publicerad som version/).first()
    await expect(done).toBeVisible({ timeout: 30000 })
    info.annotations.push({ type: 'publish result', description: (await done.textContent()) ?? '' })
    // First publish activates at once; later ones switch over at a scheduled time (by design).
    expect(await done.textContent()).toMatch(/aktiverad som version|bytet sker/)
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
