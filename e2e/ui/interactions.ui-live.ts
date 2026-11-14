import { expect } from '@playwright/test'
import { test } from '../lib/live'
import { VIEWPORTS, layoutAudit, axeIssues, assertNoIssues, record, setTheme, STABLE_CSS, type Issue } from '../lib/ui-audit'

/** Modals on real data (deployed dev), phone and desktop, light and dark. Read-only: modals are opened and closed, never saved. */
for (const vp of VIEWPORTS.filter((v) => ['390', '1440'].includes(v.name))) {
  for (const theme of ['light', 'dark'] as const) {
    const phone = vp.kind === 'phone'
    const go = async (page: import('@playwright/test').Page, path: string) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await setTheme(page, theme)
      await page.goto(path)
      await page.waitForSelector('.admin-shell', { timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
      const skip = page.locator('.guide-skip')
      if (await skip.isVisible().catch(() => false)) await skip.click()
      await page.addStyleTag({ content: STABLE_CSS })
      await page.waitForTimeout(500)
    }
    const dialogChecks = async (page: import('@playwright/test').Page, name: string, issues: Issue[]) => {
      const dlg = page.getByRole('dialog').first()
      await expect(dlg).toBeVisible()
      await page.waitForTimeout(400)
      const b = await dlg.boundingBox()
      if (b && b.width < vp.width - 4 && Math.abs(b.x + b.width / 2 - vp.width / 2) > 6) issues.push({ kind: 'modal-centre', severity: 'medium', message: `${name}: dialog is not horizontally centred` })
      if (b && (b.x < -1 || b.x + b.width > vp.width + 1)) issues.push({ kind: 'modal-bounds', severity: 'high', message: `${name}: dialog leaves the window sideways` })
      issues.push(...(await layoutAudit(page, { phone, helpSelector: '.help-launcher', atBottom: false })).filter((i) => i.kind !== 'tap-target'))
      issues.push(...(await axeIssues(page)))
      return dlg
    }

    test(`categories modal ${vp.name} ${theme}`, async ({ page }, info) => {
      await go(page, '/meny')
      const issues: Issue[] = []
      await page.getByRole('button', { name: /^Kategorier/ }).first().click()
      const dlg = await dialogChecks(page, 'Kategorier', issues)
      await page.screenshot({ path: info.outputPath('categories.png') })
      await page.keyboard.press('Escape')
      if (await dlg.isVisible().catch(() => false)) issues.push({ kind: 'modal-close', severity: 'medium', message: 'Escape does not close the Kategorier dialog' })
      record(info, 'admin-live', 'interaction:categories-modal', vp.name, theme, issues)
      assertNoIssues(issues)
    })

    test(`add dish modal ${vp.name} ${theme}`, async ({ page }, info) => {
      await go(page, '/meny')
      const issues: Issue[] = []
      await page.getByRole('button', { name: /Lägg till|Ny rätt|Ny$/ }).first().click()
      const dlg = await dialogChecks(page, 'Ny rätt', issues)
      // the save bar must be reachable and not covered by the help button
      const save = dlg.getByRole('button', { name: /Spara|Lägg till/ }).first()
      if (await save.count()) {
        await save.scrollIntoViewIfNeeded()
        const sb = await save.boundingBox()
        const hb = await page.locator('.help-launcher').boundingBox()
        if (sb && hb && sb.x < hb.x + hb.width && sb.x + sb.width > hb.x && sb.y < hb.y + hb.height && sb.y + sb.height > hb.y) issues.push({ kind: 'help-overlap', severity: 'high', message: 'Save button in the dish dialog overlaps the floating help button' })
      }
      await page.screenshot({ path: info.outputPath('dish.png') })
      record(info, 'admin-live', 'interaction:dish-modal', vp.name, theme, issues)
      assertNoIssues(issues)
    })

    test(`info tooltip inside window ${vp.name} ${theme}`, async ({ page }, info) => {
      await go(page, '/installningar')
      const issues: Issue[] = []
      const triggers = page.locator('.info-tooltip-trigger')
      const n = await triggers.count()
      for (let i = 0; i < Math.min(n, 15); i++) {
        const t = triggers.nth(i)
        // triggers inside a closed section are hidden on purpose: skip them before scrolling (scrolling waits for visibility)
        if (!(await t.isVisible())) continue
        await t.scrollIntoViewIfNeeded()
        await t.click()
        const panel = page.locator('.info-tooltip-panel').first()
        await expect(panel).toBeVisible()
        const b = await panel.boundingBox()
        if (b && (b.x < -1 || b.x + b.width > vp.width + 1 || b.y < -1)) issues.push({ kind: 'tooltip-offscreen', severity: 'high', message: `Tooltip leaves the window (x ${Math.round(b.x)}, right ${Math.round(b.x + b.width)} of ${vp.width})`, selector: (await t.getAttribute('aria-label')) ?? '' })
        await page.keyboard.press('Escape')
      }
      record(info, 'admin-live', 'interaction:tooltip', vp.name, theme, issues)
      assertNoIssues(issues)
    })
  }
}
