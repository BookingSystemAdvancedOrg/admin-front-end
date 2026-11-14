import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'

test.describe('Admin: first login and onboarding', () => {
  test('Kom igång checklist is shown to a new restaurant', async ({ page }) => {
    await page.goto('/')
    await ready(page, 'Översikt')
    await expect(page.getByRole('region', { name: 'Kom igång' })).toBeVisible()
  })

  test('deep link to a page works on a fresh load (not bounced to Översikt)', async ({ page }) => {
    await page.goto('/meny')
    await page.waitForTimeout(3000)
    await expect(page).toHaveURL(/\/meny$/)
  })

  test('accept the data processing agreement (DPA), site goes live', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/avtal')
    await ready(page, 'Avtal')
    const accepted = page.getByText(/Version .+ godkändes/)
    if (!(await accepted.isVisible())) {
      const box = page.getByRole('checkbox', { name: /Jag har läst avtalet/ })
      await expect(page.getByRole('button', { name: 'Godkänn avtalet' })).toBeDisabled()
      await box.check()
      await page.getByRole('button', { name: 'Godkänn avtalet' }).click()
      await expect(page).toHaveURL(/\/$/, { timeout: 20000 })
      await page.screenshot({ path: info.outputPath('after-accept.png') })
      await page.goto('/avtal')
      await ready(page, 'Avtal')
    }
    await expect(accepted).toBeVisible()
    await page.goto('/')
    await ready(page, 'Översikt')
    await expect(page.getByText('Webbplatsen är inte publicerad än')).toHaveCount(0)
    await w.attach(info)
  })

  test('opening hours: every day 10:00-23:30, saved and reloaded', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/installningar')
    await ready(page, 'Inställningar')
    for (const day of ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag']) {
      const opens = page.getByLabel(`${day} öppnar`)
      if ((await opens.count()) === 0) {
        await page.locator('.hours-editor-row', { hasText: day }).getByRole('button', { name: '+ Lägg till tid' }).click()
      }
      await page.getByLabel(`${day} öppnar`).first().fill('10:00')
      await page.getByLabel(`${day} stänger`).first().fill('23:30')
    }
    await page.getByRole('button', { name: 'Spara ändringar' }).click()
    await page.waitForTimeout(3000)
    await page.screenshot({ path: info.outputPath('after-save.png'), fullPage: true })
    await page.reload()
    await ready(page, 'Inställningar')
    await expect(page.getByLabel('Måndag öppnar')).toHaveValue('10:00')
    await expect(page.getByLabel('Lördag stänger')).toHaveValue('23:30')
    await w.attach(info)
  })

  test('opening hours past midnight (bar open Saturday 18:00-02:00) can be saved', async ({ page }, info) => {
    await page.goto('/installningar')
    await ready(page, 'Inställningar')
    await page.getByLabel('Lördag öppnar').first().fill('18:00')
    await page.getByLabel('Lördag stänger').first().fill('02:00')
    await page.getByRole('button', { name: 'Spara ändringar' }).click()
    await page.waitForTimeout(2500)
    await page.screenshot({ path: info.outputPath('midnight.png') })
    const err = await page.locator('.form-error, [role=alert]').filter({ hasText: /stängningstiden/ }).first().textContent().catch(() => null)
    const button = await page.locator('header button, .topbar button').filter({ hasText: /Klart|Spara/ }).first().textContent().catch(() => '')
    info.annotations.push({ type: 'after save', description: `error="${err}" button="${button}"` })
    expect.soft(err, 'past-midnight hours refused').toBeNull()
    expect.soft(err && /Klart/.test(button ?? ''), 'button says "Klart!" although the save failed').toBeFalsy()
    expect.soft(err ?? '', 'error names the day in English').not.toMatch(/saturday|monday|sunday/)
    await page.reload()
  })
})
