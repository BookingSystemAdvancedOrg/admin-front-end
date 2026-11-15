import { test, expect, type Page } from '@playwright/test'
import { VIEWPORTS, fullAudit, layoutAudit, axeIssues, assertNoIssues, record, setTheme, STABLE_CSS, type Issue } from '../lib/ui-audit'
import { options, pick, valueOf } from '../lib/select'

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
        // triggers inside a closed section are hidden on purpose: skip them before scrolling (scrolling waits for visibility)
        if (!(await t.isVisible())) continue
        await t.scrollIntoViewIfNeeded()
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

    test(`dropdown opens the Booqy list ${vp.name} ${theme} @x`, async ({ page }, info) => {
      await open(page, '/meny', vp, theme)
      const issues: Issue[] = []
      const box = page.getByRole('combobox', { name: 'Status' })
      await box.scrollIntoViewIfNeeded()
      const before = await box.getAttribute('value')
      await box.click()
      const list = page.getByRole('listbox')
      await expect(list).toBeVisible()
      await page.waitForTimeout(300)
      const b = await list.boundingBox()
      if (!b || b.x < -1 || b.x + b.width > vp.width + 1 || b.y < -1 || b.y + b.height > vp.height + 1) issues.push({ kind: 'dropdown-bounds', severity: 'high', message: `Dropdown list outside the window: ${JSON.stringify(b)}` })
      const sheet = await page.locator('.b-select-sheet').count()
      if (phone !== sheet > 0) issues.push({ kind: 'dropdown-sheet', severity: 'high', message: phone ? 'No bottom sheet on a phone' : 'Bottom sheet on a large screen' })
      const rowH = (await list.getByRole('option').first().boundingBox())?.height ?? 0
      if (phone && rowH < 47.5) issues.push({ kind: 'dropdown-rows', severity: 'medium', message: `Phone rows are ${rowH}px, want 48` })
      issues.push(...(await axeIssues(page)))
      await page.screenshot({ path: info.outputPath('dropdown-open.png') })
      // Tangentbord: nedåt och Enter väljer nästa, Escape stänger utan att ändra.
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(list).toHaveCount(0)
      const after = await box.getAttribute('value')
      if (after === before) issues.push({ kind: 'dropdown-keyboard', severity: 'high', message: 'ArrowDown + Enter did not change the value' })
      await box.focus()
      await page.keyboard.press('ArrowDown')
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(box).toBeFocused()
      // Ett rull-event som redan var på väg när listan öppnades stänger den inte.
      await page.evaluate(() => window.scrollBy(0, 1))
      await box.click()
      await page.evaluate(() => document.dispatchEvent(new Event('scroll')))
      await page.waitForTimeout(200)
      if ((await box.getAttribute('aria-expanded')) !== 'true') issues.push({ kind: 'dropdown-scroll', severity: 'high', message: 'List closed by a scroll that did not move the field' })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      // Hjälparna som e2e-specarna mot dev använder.
      const texts = await options(box)
      if (texts.length < 2) issues.push({ kind: 'dropdown-helpers', severity: 'high', message: `options() read ${texts.length} options` })
      await pick(box, { label: texts[1] ?? '' })
      const second = await valueOf(box)
      await pick(box, { index: 0 })
      if ((await valueOf(box)) === second) issues.push({ kind: 'dropdown-helpers', severity: 'high', message: 'pick({ index }) did not change the value' })
      await pick(box, second)
      if ((await valueOf(box)) !== second) issues.push({ kind: 'dropdown-helpers', severity: 'high', message: 'pick(value) did not choose the value' })
      finish(info, 'dropdown', vp.name, theme, issues)
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
