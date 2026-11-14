import { expect } from '@playwright/test'
import { test } from '../lib/live'
import { VIEWPORTS, CROSS_BROWSER, fullAudit, axeIssues, assertNoIssues, record, setTheme, STABLE_CSS, type Issue } from '../lib/ui-audit'

const PAGES = ['', 'statistik', 'bokningar', 'bestallningar', 'meny', 'cateringkalkyl', 'catering', 'personal', 'personalliggare', 'telefon', 'layout', 'gaster', 'presentkort', 'webbplats', 'evenemang', 'marknadsforing', 'installningar', 'hjalp', 'avtal']

for (const pg of PAGES) {
  const name = pg || 'oversikt'
  test.describe(name, () => {
    for (const vp of VIEWPORTS) {
      for (const theme of ['light', 'dark'] as const) {
        const tag = CROSS_BROWSER.includes(vp.name) ? ' @x' : ''
        test(`${name} ${vp.name} ${theme}${tag}`, async ({ page }, info) => {
          await page.setViewportSize({ width: vp.width, height: vp.height })
          await setTheme(page, theme)
          await page.goto('/' + pg)
          await page.waitForSelector('.admin-shell', { timeout: 30000 })
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
          await expect(page.locator('.printing, [aria-busy=true]')).toHaveCount(0, { timeout: 20000 }).catch(() => {})
          const skip = page.locator('.guide-skip')
          if (await skip.isVisible().catch(() => false)) await skip.click()
          await page.addStyleTag({ content: STABLE_CSS })
          await page.waitForTimeout(500)
          const issues: Issue[] = []
          if (/logga-in/.test(page.url())) issues.push({ kind: 'session', severity: 'critical', message: 'Sent back to the login page (session lost in test run)' })
          issues.push(...(await fullAudit(page, { phone: vp.kind === 'phone', helpSelector: '.help-launcher' })))
          issues.push(...(await axeIssues(page)))
          record(info, 'admin-live', name, vp.name, theme, issues)
          assertNoIssues(issues)
        })
      }
    }
  })
}
