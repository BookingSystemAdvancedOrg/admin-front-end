import { test, expect } from '@playwright/test'
import { ready } from '../lib/ui'

// Scratch spec (not committed): Kom igång end to end on the E2E restaurant in dev.
const card = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Kom igång' })

test('skip every open step until Kom igång is finished', async ({ page }, info) => {
  test.skip(process.env.KOM !== 'skip')
  const answers: { complete: boolean; completedAt: string | null; open: number }[] = []
  page.on('response', async (r) => {
    if (/\/tenant\/setup(\/skips)?$/.test(new URL(r.url()).pathname) && r.ok()) answers.push(await r.json().catch(() => null))
  })
  await page.goto('/')
  await ready(page, 'Översikt')
  await expect(card(page)).toBeVisible()
  await page.screenshot({ path: info.outputPath('before.png'), fullPage: true })
  for (let i = 0; i < 15; i++) {
    const btn = card(page).getByRole('button', { name: /^Hoppa över: / }).first()
    if (!(await btn.isVisible().catch(() => false))) break
    console.log('skip', await btn.getAttribute('aria-label'))
    await Promise.all([page.waitForResponse((r) => r.url().includes('/tenant/setup/skips') && r.status() === 200), btn.click()])
    await page.waitForTimeout(400)
  }
  await expect(page.getByText('Kom igång: allt är klart')).toBeVisible()
  const last = answers.filter(Boolean).at(-1)!
  console.log('last', JSON.stringify({ complete: last.complete, completedAt: last.completedAt, open: last.open }))
  expect(last.complete).toBe(true)
  expect(last.completedAt).toBeTruthy()
  await page.screenshot({ path: info.outputPath('after.png'), fullPage: true })
})

test('undo the skips this test made', async ({ page }) => {
  test.skip(process.env.KOM !== 'undo')
  await page.goto('/')
  await ready(page, 'Översikt')
  const summary = page.getByText('Kom igång: allt är klart')
  if (await summary.isVisible().catch(() => false)) await summary.click()
  for (let i = 0; i < 15; i++) {
    const btn = page.getByRole('button', { name: /^Ångra överhoppat: / }).first()
    if (!(await btn.isVisible().catch(() => false))) break
    console.log('undo', await btn.getAttribute('aria-label'))
    await Promise.all([page.waitForResponse((r) => r.url().includes('/tenant/setup/skips') && r.status() === 200), btn.click()])
    await page.waitForTimeout(400)
  }
  await expect(page.getByRole('button', { name: /^Ångra överhoppat: / })).toHaveCount(0)
})
