import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'

/** Phone 375/393 and tablet 768 in Chromium; the iphone project runs these in WebKit (Safari). */
const PAGES: [string, RegExp][] = [['/', /Översikt/], ['/bokningar', /Bokningar/], ['/bestallningar', /Beställningar/], ['/meny', /Meny/], ['/layout', /Layout/], ['/statistik', /Statistik/], ['/installningar', /Inställningar/], ['/personal', /Personal/]]
const WIDTHS = test.info === undefined ? [] : [375, 393, 768]

for (const width of [375, 393, 768]) {
  test.describe(`Admin at ${width}px @mobile`, () => {
    test.use({ viewport: { width, height: width === 768 ? 1024 : 812 } })
    for (const [path, h] of PAGES) {
      test(`${path} fits the screen @mobile`, async ({ page }, info) => {
        test.skip(info.project.name === 'iphone' && width !== 393, 'iPhone runs at 393 only')
        const w = watch(page)
        await page.goto(path)
        await ready(page, h)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        await page.screenshot({ path: info.outputPath(`${width}${path.replace(/\W/g, '_')}.png`) })
        info.annotations.push({ type: 'overflow px', description: String(overflow) })
        expect.soft(overflow, 'no horizontal scroll').toBeLessThanOrEqual(2)
        const pageErrors = w.consoleErrors.filter((e) => e.startsWith('pageerror'))
        expect.soft(pageErrors, pageErrors.join('\n')).toEqual([])
      })
    }
    test('menu drawer opens and navigates @mobile', async ({ page }, info) => {
      test.skip(width === 768 && info.project.name !== 'chromium', 'tablet once')
      await page.goto('/')
      await ready(page, 'Översikt')
      const burger = page.getByRole('button', { name: /meny|Öppna menyn|Menu/i }).first()
      if (await burger.isVisible().catch(() => false)) await burger.click()
      await page.getByRole('link', { name: 'Bokningar' }).first().click()
      await ready(page, 'Bokningar')
    })
    test('new booking modal is usable @mobile', async ({ page }, info) => {
      await page.goto('/bokningar')
      await ready(page, 'Bokningar')
      await page.getByRole('button', { name: '+ Ny bokning' }).click()
      const dlg = page.getByRole('dialog', { name: 'Ny bokning' })
      await expect(dlg).toBeVisible()
      const box = await dlg.boundingBox()
      await page.screenshot({ path: info.outputPath(`${width}-modal.png`) })
      expect.soft(box!.width, 'modal fits the width').toBeLessThanOrEqual(width + 1)
      await dlg.getByRole('button', { name: 'Avbryt' }).scrollIntoViewIfNeeded()
      await dlg.getByRole('button', { name: 'Avbryt' }).click()
    })
  })
}
void WIDTHS
