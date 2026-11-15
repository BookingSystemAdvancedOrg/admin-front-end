import { test, expect } from '@playwright/test'
import { VIEWPORTS, CROSS_BROWSER, VISUAL, fullAudit, axeIssues, focusIssues, assertNoIssues, record, setTheme, STABLE_CSS, type Issue } from '../lib/ui-audit'

/**
 * Every admin route x every screen size x light/dark: layout audit, axe
 * (serious/critical), focus visibility, and visual baselines at VISUAL sizes.
 * Runs on mock data (see playwright.ui.config.ts).
 */
export const PAGES: { name: string; path: string; heading?: RegExp }[] = [
  { name: 'oversikt', path: '/' },
  { name: 'statistik', path: '/statistik' },
  { name: 'bokningar', path: '/bokningar' },
  { name: 'bestallningar', path: '/bestallningar' },
  { name: 'meny', path: '/meny' },
  { name: 'cateringkalkyl', path: '/cateringkalkyl' },
  { name: 'catering', path: '/catering' },
  { name: 'personal', path: '/personal' },
  { name: 'personalliggare', path: '/personalliggare' },
  { name: 'telefon', path: '/telefon' },
  { name: 'layout', path: '/layout' },
  { name: 'gaster', path: '/gaster' },
  { name: 'presentkort', path: '/presentkort' },
  { name: 'webbplats', path: '/webbplats' },
  { name: 'evenemang', path: '/evenemang' },
  { name: 'marknadsforing', path: '/marknadsforing' },
  { name: 'installningar', path: '/installningar' },
  { name: 'hjalp', path: '/hjalp' },
  { name: 'avtal', path: '/avtal' },
]

const THEMES = ['light', 'dark'] as const

for (const pg of PAGES) {
  test.describe(pg.name, () => {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const tag = CROSS_BROWSER.includes(vp.name) ? ' @x' : ''
        test(`${pg.name} ${vp.name} ${theme}${tag}`, async ({ page }, info) => {
          await page.setViewportSize({ width: vp.width, height: vp.height })
          await setTheme(page, theme)
          await page.clock.setFixedTime(new Date('2026-11-14T10:00:00+01:00'))
          await page.addInitScript(() => sessionStorage.setItem('admin-mock-session', 'test@test.se'))
          await page.goto(pg.path)
          await page.waitForSelector('.admin-shell', { timeout: 20000 })
          await page.waitForLoadState('networkidle').catch(() => {})
          await expect(page.locator('.printing')).toHaveCount(0, { timeout: 15000 }).catch(() => {})
          // the intro guide always shows on mock login (no user id); it has its own test
          const skip = page.locator('.guide-skip')
          if (await skip.isVisible().catch(() => false)) await skip.click()
          await page.addStyleTag({ content: STABLE_CSS })
          await page.waitForTimeout(400)
          const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
          const issues: Issue[] = []
          if (dataTheme && dataTheme !== theme) issues.push({ kind: 'theme', severity: 'high', message: `data-theme is ${dataTheme}, expected ${theme}` })

          issues.push(...(await fullAudit(page, { phone: vp.kind === 'phone', helpSelector: '.help-launcher' })))
          issues.push(...(await axeIssues(page)))
          if (info.project.name === 'chromium') issues.push(...(await focusIssues(page)))

          let shot: string | undefined
          if (info.project.name === 'chromium' && VISUAL.includes(vp.name)) {
            const mask = [page.locator('time, [data-dynamic], .num, [class*=Num]')]
            try {
              await expect(page).toHaveScreenshot(`${pg.name}-${vp.name}-${theme}.png`, { mask, fullPage: false })
            } catch (e) {
              issues.push({ kind: 'visual', severity: 'medium', message: 'Differs from baseline: ' + String((e as Error).message).split('\n')[0] })
            }
            shot = 'visual'
          }
          const real = issues.filter((i) => i.severity !== 'low' || true)
          record(info, 'admin', pg.name, vp.name, theme, real, { shot })
          assertNoIssues(issues.filter((i) => i.kind !== 'visual'))
          expect.soft(issues.filter((i) => i.kind === 'visual'), 'visual baseline').toEqual([])
        })
      }
    }
  })
}
