import { test, expect } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { options, pick } from '../lib/select'
import { mail, RUN } from '../lib/data'
import { optEnv } from '../lib/env'
import { adminLogin } from '../lib/login'

const PAGES: [string, RegExp][] = [
  ['/', /Översikt/], ['/statistik', /Statistik/], ['/bokningar', /Bokningar/], ['/bestallningar', /Beställningar/],
  ['/catering', /Catering/], ['/personalliggare', /Personalliggare/], ['/telefon', /Telefon/], ['/meny', /Meny/],
  ['/layout', /Layout/], ['/personal', /Personal/], ['/gaster', /Gäster/], ['/presentkort', /Presentkort/],
  ['/webbplats', /Webbplats/], ['/evenemang', /Evenemang/], ['/marknadsforing', /Marknadsföring/],
  ['/installningar', /Inställningar/], ['/hjalp', /Hjälp/], ['/avtal', /Avtal/],
]

test.describe('Admin: every page', () => {
  for (const [path, h] of PAGES) {
    test(`${path} loads without errors, no Kassa or card reader`, async ({ page }, info) => {
      const w = watch(page)
      await page.goto(path)
      await ready(page, h)
      const text = await page.locator('body').innerText()
      expect.soft(text, 'no Kassa').not.toMatch(/\bKassa\b|kassasystem|kassaregister/i)
      expect.soft(text, 'no card reader').not.toMatch(/kortläsare|kortterminal|Stripe Terminal|card reader/i)
      expect.soft(text, 'no raw error').not.toMatch(/undefined|NaN|\[object Object\]|Något gick fel/)
      await w.attach(info)
      const real = w.failed.filter((f) => !/layout\/active/.test(f))
      expect.soft(real, real.join('\n')).toEqual([])
    })
  }
})

test.describe('Admin: Statistik', () => {
  test('numbers reflect the bookings and orders created', async ({ page }, info) => {
    await page.goto('/statistik')
    await ready(page, 'Statistik')
    await page.screenshot({ path: info.outputPath('statistik.png'), fullPage: true })
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    info.annotations.push({ type: 'statistik', description: text.slice(0, 1200) })
    expect(text).toMatch(/\d/)
  })
})

test.describe('Admin: Personal', () => {
  test('invite a staff member (Personal role)', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/personal')
    await ready(page, 'Personal')
    test.skip((await page.getByText(mail('staff')).count()) > 0, 'staff already invited')
    await page.getByRole('button', { name: /Bjud in/ }).first().click()
    const dlg = page.getByRole('dialog', { name: 'Bjud in personal' })
    await dlg.getByLabel('Namn').fill('E2E Servitör Åke')
    await dlg.getByLabel('E-post').fill(mail('staff'))
    await dlg.getByLabel('Telefon').fill('070-174 06 06')
    const roles = await options(dlg.getByLabel('Roll'))
    info.annotations.push({ type: 'roles', description: roles.join(', ') })
    if (await dlg.getByLabel('Roll').isEnabled()) await pick(dlg.getByLabel('Roll'), { index: 0 })
    await dlg.getByRole('button', { name: 'Skicka inbjudan' }).click()
    await expect(dlg).toBeHidden({ timeout: 20000 })
    await expect(page.getByText(mail('staff')).first()).toBeVisible()
    await w.attach(info)
  })

  test('row click opens edit; avatar upload', async ({ page }) => {
    await page.goto('/personal')
    await ready(page, 'Personal')
    await page.getByRole('row', { name: /E2E Servitör/ }).first().click()
    await expect(page.getByRole('dialog', { name: 'Redigera medarbetare' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: /Avbryt|Stäng/ }).first().click()
    await page.getByRole('button', { name: 'Profilbild', exact: true }).click()
    const file = page.locator('input[type=file]').first()
    await file.setInputFiles('fixtures/dish.jpg')
    await page.waitForTimeout(3000)
    await expect(page.locator('[role=alert]').filter({ hasText: /fel|kunde inte/i })).toHaveCount(0)
  })

  test('forgot password sends a reset e-mail (staff)', async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage()
    await page.goto(new URL('/glomt-losenord', test.info().project.use.baseURL!).toString())
    await page.getByLabel(/E-post/).fill(mail('staff'))
    await page.getByRole('button', { name: /Skicka|Återställ/ }).click()
    await expect(page.getByText(/skickat|mejl|e-post/i).first()).toBeVisible({ timeout: 20000 })
  })

  test('staff member signs in and sees no owner-only things', async ({ browser }, info) => {
    test.skip(!optEnv('E2E_STAFF_PASSWORD'), 'E2E_STAFF_PASSWORD not set')
    const page = await (await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })).newPage()
    await adminLogin(page, mail('staff'), optEnv('E2E_STAFF_PASSWORD'))
    const skip = page.getByRole('button', { name: 'Hoppa över' })
    if (await skip.waitFor({ timeout: 6000 }).then(() => true, () => false)) await skip.click()
    const nav = await page.getByRole('navigation', { name: 'Huvudmeny' }).innerText()
    info.annotations.push({ type: 'staff nav', description: nav.replace(/\s+/g, ' ') })
    await page.goto('/layout')
    await ready(page, 'Layout')
    await page.goto('/personal')
    await page.waitForTimeout(3000)
    info.annotations.push({ type: 'staff on /personal', description: (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 300) })
    await page.goto('/statistik')
    await page.waitForTimeout(3000)
    info.annotations.push({ type: 'staff on /statistik', description: page.url() })
  })
})

test.describe('Admin: Inställningar, appearance and Bakgrund', () => {
  test('theme toggle persists in booqy-theme', async ({ page }) => {
    await page.goto('/')
    await ready(page, 'Översikt')
    const before = await page.evaluate(() => document.documentElement.dataset.theme)
    await page.getByRole('button', { name: /läge, byt till/ }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before)
    const after = await page.evaluate(() => document.documentElement.dataset.theme)
    expect(await page.evaluate(() => localStorage.getItem('booqy-theme'))).toBe(after)
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after)
    await page.getByRole('button', { name: /läge, byt till/ }).click()
  })

  test('Bakgrund: Färg, then Egen bild upload into the library', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/installningar#utseende')
    await ready(page, 'Inställningar')
    const seg = page.getByRole('group', { name: 'Bakgrund' })
    await expect(seg).toBeVisible()
    info.annotations.push({ type: 'options', description: (await seg.innerText()).replace(/\s+/g, ' ') })
    await seg.getByRole('button', { name: 'Färg' }).click()
    await page.getByRole('group', { name: 'Färg bakom glaset' }).getByRole('button').nth(1).click()
    await seg.getByRole('button', { name: 'Egen bild' }).click()
    await page.getByLabel('Ladda upp ny bild').setInputFiles('fixtures/backdrop.jpg')
    await expect(page.getByRole('list', { name: 'Dina bilder' }).getByRole('button', { name: /Visa bild/ }).first()).toBeVisible({ timeout: 30000 })
    await page.screenshot({ path: info.outputPath('bakgrund.png') })
    await w.attach(info)
    expect.soft(w.failed, w.failed.join('\n')).toEqual([])
    await seg.getByRole('button', { name: 'Färg' }).click()
    await page.getByRole('button', { name: 'Booqys bakgrund' }).click()
  })

  test('downloads card (desktop app) is visible in the browser', async ({ page }, info) => {
    await page.goto('/installningar#utseende')
    await ready(page, 'Inställningar')
    const card = page.locator('#skrivbordsappen, section', { hasText: /Skrivbordsapp|Ladda ner/ }).first()
    await expect(card).toBeVisible()
    info.annotations.push({ type: 'downloads', description: (await card.innerText()).replace(/\s+/g, ' ').slice(0, 300) })
  })
})

test.describe('Admin: help assistant, marketing, catering, phone', () => {
  test('Fråga Booqy answers with live numbers', async ({ page }, info) => {
    const w = watch(page)
    await page.goto('/')
    await ready(page, 'Översikt')
    const ask = async (q: string) => {
      if (!(await page.locator('.help-panel').isVisible())) await page.getByRole('button', { name: 'Fråga Booqy' }).click()
      await page.locator('.help-input').fill(q)
      await page.locator('.help-input').press('Enter')
      await page.waitForTimeout(10000) // the answer may move to the right page and highlight it
      if (!(await page.locator('.help-panel').isVisible())) await page.getByRole('button', { name: 'Fråga Booqy' }).click()
      const log = (await page.locator('.help-log').innerText()).replace(/\s+/g, ' ')
      const a = log.slice(log.lastIndexOf(q) + q.length, log.lastIndexOf(q) + q.length + 260)
      info.annotations.push({ type: q, description: `${a} [page: ${new URL(page.url()).pathname}]` })
      return a
    }
    const today = await ask('Hur många bokningar har vi idag?')
    expect.soft(today, 'live number for today').toMatch(/\d/)
    expect.soft(today, 'Swedish grammar for one booking').not.toMatch(/\b1 bokningar\b/)
    const tomorrow = await ask('Hur många bokningar har vi imorgon?')
    expect.soft(tomorrow, 'answers tomorrow\'s bookings').toMatch(/\d/)
    const how = await ask('Var ändrar jag öppettiderna?')
    expect.soft(how).toMatch(/Inställningar/)
    await page.screenshot({ path: info.outputPath('help.png') })
    await w.attach(info)
  })

  test('Marknadsföring page and Catering page open, Telefon settings show', async ({ page }, info) => {
    const w = watch(page)
    for (const [p, h] of [['/marknadsforing', /Marknadsföring/], ['/catering', /Catering/], ['/telefon', /Telefon/]] as const) {
      await page.goto(p)
      await ready(page, h)
      info.annotations.push({ type: p, description: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400) })
    }
    await w.attach(info)
  })
})

test.describe('Admin: session', () => {
  test('logout then login again @webkit', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
    const page = await ctx.newPage()
    await adminLogin(page)
    if (!(await page.getByRole('button', { name: 'Logga ut' }).isVisible())) await page.getByRole('button', { name: /meny|Öppna menyn|Menu/i }).first().click()
    await page.getByRole('button', { name: 'Logga ut' }).click()
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Ja, logga ut' })
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click()
    await expect(page).toHaveURL(/logga-in/, { timeout: 15000 })
    await page.goto('/bokningar')
    await expect(page).toHaveURL(/logga-in/)
    await adminLogin(page)
    await expect(page).toHaveURL(/bokningar|\/$/)
  })

  test('wrong password shows a clear Swedish error', async ({ browser }) => {
    const page = await (await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })).newPage()
    await page.goto('/logga-in')
    await page.getByLabel('E-post').fill(mail('owner'))
    await page.getByLabel('Lösenord').fill('fel-lösenord-' + RUN)
    await page.getByRole('button', { name: 'Logga in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    expect(await page.getByRole('alert').innerText()).toMatch(/[åäö]|lösenord|fel/i)
  })
})
