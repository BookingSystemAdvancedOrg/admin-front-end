import { test, expect, type Page } from '@playwright/test'
import { VIEWPORTS, fullAudit, layoutAudit, axeIssues, assertNoIssues, record, setTheme, STABLE_CSS, type Issue } from '../lib/ui-audit'

/** Key interactions at phone (390) and desktop (1440) size, light and dark. */
const SIZES = VIEWPORTS.filter((v) => ['390', '1440'].includes(v.name))

async function open(page: Page, path: string, vp: (typeof SIZES)[number], theme: 'light' | 'dark', skipGuide = true) {
  await page.setViewportSize({ width: vp.width, height: vp.height })
  await setTheme(page, theme)
  await page.clock.setFixedTime(new Date('2026-11-14T10:00:00+01:00'))
  await page.addInitScript(() => sessionStorage.setItem('admin-mock-session', 'test@test.se'))
  await page.goto(path)
  await page.waitForSelector('.admin-shell', { timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.addStyleTag({ content: STABLE_CSS })
  const skip = page.locator('.guide-skip')
  if (skipGuide && (await skip.isVisible().catch(() => false))) await skip.click()
  await page.waitForTimeout(300)
}

const opts = (phone: boolean) => ({ phone, helpSelector: '.help-launcher' })
/** Overlay-specific audit: no tap-target noise, only containment/overlap. */
const finish = (info: Parameters<Parameters<typeof test>[2]>[1], name: string, vp: string, theme: string, issues: Issue[]) => {
  record(info, 'admin', 'interaction:' + name, vp, theme, issues)
  assertNoIssues(issues)
}

for (const vp of SIZES) {
  for (const theme of ['light', 'dark'] as const) {
    const phone = vp.kind === 'phone'

    if (phone) {
      test(`drawer opens and closes ${vp.name} ${theme}`, async ({ page }, info) => {
        await open(page, '/', vp, theme)
        const issues: Issue[] = []
        await page.getByRole('button', { name: 'Meny', exact: true }).click()
        const sidebar = page.locator('#admin-sidebar')
        await expect(sidebar).toBeVisible()
        await page.waitForTimeout(300)
        const box = await sidebar.boundingBox()
        if (!box || box.x < -1 || box.x + box.width > vp.width + 1) issues.push({ kind: 'drawer-bounds', severity: 'high', message: `Drawer outside the window: ${JSON.stringify(box)}` })
        issues.push(...(await layoutAudit(page, { ...opts(true), atBottom: false })).filter((i) => i.kind !== 'tap-target' && i.kind !== 'covered'))
        await page.screenshot({ path: info.outputPath('drawer-open.png') })
        await page.keyboard.press('Escape')
        const stillOpen = await page.locator('.admin-shell.drawer-open').count()
        if (stillOpen) await page.locator('.admin-drawer-scrim').click({ position: { x: vp.width - 5, y: 300 } })
        await expect(page.locator('.admin-shell.drawer-open')).toHaveCount(0)
        finish(info, 'drawer', vp.name, theme, issues)
      })
    }

    test(`info tooltip stays inside the window ${vp.name} ${theme}`, async ({ page }, info) => {
      await open(page, '/installningar', vp, theme)
      const issues: Issue[] = []
      const triggers = page.locator('.info-tooltip-trigger')
      const n = await triggers.count()
      for (let i = 0; i < Math.min(n, 12); i++) {
        const t = triggers.nth(i)
        await t.scrollIntoViewIfNeeded()
        if (!(await t.isVisible())) continue
        await t.click()
        const panel = page.locator('.info-tooltip-panel').first()
        await expect(panel).toBeVisible()
        const b = await panel.boundingBox()
        if (b && (b.x < -1 || b.x + b.width > vp.width + 1 || b.y < -1)) issues.push({ kind: 'tooltip-offscreen', severity: 'high', message: `Tooltip ${i + 1} leaves the window (x ${Math.round(b.x)}, right ${Math.round(b.x + b.width)}, y ${Math.round(b.y)} of ${vp.width})`, selector: await t.getAttribute('aria-label') ?? '' })
        await page.keyboard.press('Escape')
      }
      if (n === 0) test.info().annotations.push({ type: 'note', description: 'no info tooltips on this page' })
      finish(info, 'tooltip', vp.name, theme, issues)
    })

    test(`theme toggle ${vp.name} ${theme}`, async ({ page }, info) => {
      await open(page, '/', vp, theme)
      const issues: Issue[] = []
      const toggle = page.locator('.theme-toggle[data-mode]').filter({ visible: true }).first()
      if (!(await toggle.count())) issues.push({ kind: 'theme-toggle', severity: 'high', message: 'No visible theme toggle on the start page' })
      else {
        await toggle.click()
        await page.waitForTimeout(800)
        const want = theme === 'light' ? 'dark' : 'light'
        const got = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), ls: localStorage.getItem('booqy-theme') }))
        if (got.attr !== want) issues.push({ kind: 'theme-toggle', severity: 'high', message: `data-theme is ${got.attr} after toggle, expected ${want}` })
        if (got.ls !== want) issues.push({ kind: 'theme-toggle', severity: 'medium', message: `booqy-theme in localStorage is ${got.ls}, expected ${want}` })
        issues.push(...(await fullAudit(page, opts(phone))).filter((i) => i.kind !== 'tap-target'))
      }
      finish(info, 'theme-toggle', vp.name, theme, issues)
    })

    test(`help assistant panel ${vp.name} ${theme}`, async ({ page }, info) => {
      await open(page, '/', vp, theme)
      const issues: Issue[] = []
      await page.locator('.help-launcher').click()
      const panel = page.locator('.help-panel')
      await expect(panel).toBeVisible()
      await page.waitForTimeout(400)
      const b = await panel.boundingBox()
      if (!b || b.x < -1 || b.x + b.width > vp.width + 1 || b.y < -1 || b.y + b.height > vp.height + 1) issues.push({ kind: 'help-panel-bounds', severity: 'high', message: `Help panel outside the window: ${JSON.stringify(b)}` })
      issues.push(...(await layoutAudit(page, { ...opts(phone), atBottom: false })).filter((i) => i.kind !== 'tap-target' && i.kind !== 'covered' && i.kind !== 'help-overlap'))
      issues.push(...(await axeIssues(page)))
      await page.screenshot({ path: info.outputPath('help-open.png') })
      finish(info, 'help-panel', vp.name, theme, issues)
    })

    test(`intro guide ${vp.name} ${theme}`, async ({ page }, info) => {
      await open(page, '/', vp, theme, false)
      const issues: Issue[] = []
      const layer = page.locator('.guide-layer')
      if (await layer.isVisible().catch(() => false)) {
        const card = page.locator('.guide-layer [role=dialog], .guide-layer .guide-card, .guide-layer').first()
        const b = await card.boundingBox()
        if (b && (b.x < -1 || b.x + b.width > vp.width + 1)) issues.push({ kind: 'guide-bounds', severity: 'high', message: 'Guide card leaves the window sideways' })
        issues.push(...(await axeIssues(page)))
        await page.screenshot({ path: info.outputPath('guide.png') })
      }
      finish(info, 'guide', vp.name, theme, issues)
    })
  }
}
void expect
