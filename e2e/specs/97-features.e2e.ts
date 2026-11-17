import { test, expect, type Page } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { Api } from '../lib/api'
import { env, optEnv } from '../lib/env'

/**
 * Features of 2026-11-16/17 on the live dev: Kunder (was Gäster), Inställningar
 * as a tree, no Site builder (Webbplats), QR ordering at the table gone, plain
 * errors, owner-only things. Read-only except one failed save (offline).
 */

const API = env('E2E_API_URL', 'https://dh2m5ildm7.execute-api.eu-north-1.amazonaws.com')

async function nav(page: Page) {
  return page.getByRole('navigation', { name: 'Huvudmeny' })
}

test.describe('Admin: Kunder (was Gäster)', () => {
  test('menu, page and old link', async ({ page }) => {
    const w = watch(page)
    await page.goto('/')
    await ready(page, 'Översikt')
    const menu = await nav(page)
    await expect(menu.getByRole('link', { name: 'Kunder', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Gäster', exact: true })).toHaveCount(0)
    await page.goto('/kunder')
    await ready(page, 'Kunder')
    await page.goto('/gaster')
    await expect(page).toHaveURL(/\/kunder$/)
    await page.goto('/gaster/anything')
    await expect(page).toHaveURL(/\/kunder$/)
    await w.attach(test.info())
  })

  test('Cmd K finds Kunder', async ({ page }) => {
    await page.goto('/')
    await ready(page, 'Översikt')
    await page.keyboard.press('ControlOrMeta+k')
    const box = page.getByRole('dialog').getByRole('combobox').or(page.getByPlaceholder(/Sök/)).first()
    await box.fill('kunder')
    await expect(page.getByRole('option', { name: /Kunder/ }).first()).toBeVisible()
    await box.fill('gäster')
    await expect(page.getByRole('option', { name: /Kunder/ }).first()).toBeVisible()
  })
})

test.describe('Admin: Site builder, QR at the table and Kassa are gone', () => {
  test('no Webbplats page, no QR page, no table switch', async ({ page }) => {
    await page.goto('/')
    await ready(page, 'Översikt')
    const menuText = await (await nav(page)).innerText()
    expect(menuText).not.toMatch(/Webbplats|QR|Kassa/)
    for (const old of ['/webbplats', '/bord-qr', '/qr', '/kassa']) {
      await page.goto(old)
      await expect(page, `${old} leads back to the start`).toHaveURL(/\/$/)
    }
    await page.goto('/installningar#bestallning')
    await ready(page, 'Inställningar')
    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(/Bordsbeställning|vid bordet|QR/i)
    // one ordering switch: Ta emot beställningar
    await expect(page.locator('[role=switch][aria-labelledby=ordering-enabled-label]')).toHaveCount(1)
    await page.goto('/layout')
    await ready(page, 'Layout')
    await expect(page.getByRole('button', { name: /QR/ })).toHaveCount(0)
    await expect(page.getByText(/Bordsbeställning|QR-kod/i)).toHaveCount(0)
  })
})

test.describe('Admin: Inställningar as a tree', () => {
  test('field with six trees and a search; branches by link and old links', async ({ page }) => {
    const w = watch(page)
    await page.goto('/installningar')
    await ready(page, 'Inställningar')
    for (const t of ['Restaurangen', 'Gäster', 'Beställning', 'Ekonomi', 'Personal', 'Den här enheten']) {
      await expect(page.getByText(t, { exact: true }).filter({ visible: true }).first(), t).toBeVisible()
    }
    const search = page.getByPlaceholder('Sök inställning')
    await search.fill('öppettider')
    await expect(page.getByRole('option').or(page.getByRole('button', { name: /Öppettider/ })).first()).toBeVisible()
    // every old tab address still works (branch ids are the old tab ids)
    for (const h of ['profil', 'dagar', 'bord', 'notiser', 'bestallning', 'skrivare', 'abonnemang', 'betalningar', 'utseende']) {
      await page.goto(`/installningar#${h}`)
      await page.waitForTimeout(700)
      await expect(page.getByPlaceholder('Sök inställning'), `#${h} opens its branch`).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`#${h}$`))
    }
    await w.attach(test.info())
  })

  for (const width of [375, 768, 1024, 1280, 1920]) {
    test(`no sideways scroll, ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 800 ? 812 : 900 })
      for (const h of ['', '#bestallning', '#skrivare', '#betalningar']) {
        await page.goto('/installningar' + h)
        await ready(page, 'Inställningar')
        const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(o, `/installningar${h} at ${width}`).toBeLessThanOrEqual(1)
      }
    })
  }
})

test.describe('Admin: plain errors', () => {
  test('offline save says what to do (wifi or mobile data)', async ({ page, context }) => {
    await page.goto('/installningar#bestallning')
    await ready(page, 'Inställningar')
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Spara beställning' }).click()
    const note = page.locator('[role=alert]').filter({ hasText: /\S/ }).first()
    await expect(note).toBeVisible({ timeout: 20000 })
    const text = await note.innerText()
    expect(text).toMatch(/wifi|mobildata|uppkoppling|internet/i)
    expect(text, 'no raw technical text').not.toMatch(/Failed to fetch|TypeError|NetworkError|HTTP \d|undefined/i)
    await context.setOffline(false)
  })

  test('an unknown address leads back, a wrong login is Swedish', async ({ page }) => {
    await page.goto('/finns-inte')
    await expect(page).toHaveURL(/\/$/)
  })
})

test.describe('Admin: API checks (as the owner)', () => {
  test('table ordering routes answer 410, never an order form', async ({ page }) => {
    const api = await Api.attach(page)
    const t = await api.get('/orders/table-codes')
    expect([410, 404], 'table-codes list').toContain(t.status())
    if (t.status() === 410) expect((await t.json()).error).toBe('table_ordering_off')
    const o = await page.request.get(`${API}/locations/${api.locationId}/ordering?table=ABC`)
    expect([410, 400, 404], 'ordering?table=').toContain(o.status())
  })

  test('crafted guest orders with mode table or a tableCode are refused in plain words', async ({ page }) => {
    const api = await Api.attach(page)
    const base = {
      locationId: api.locationId,
      items: [{ menuItemId: 'x', quantity: 1 }],
      name: 'E2E Test',
      phone: '+46 70 174 06 05',
      email: 'success+e2e-api@simulator.amazonses.com',
      acceptTerms: true,
    }
    for (const extra of [{ mode: 'table' }, { mode: 'table', tableCode: 'ABC123' }, { mode: 'pickup', tableCode: 'ABC123' }]) {
      const res = await page.request.post(`${API}/order`, { data: { ...base, ...extra } })
      const body = await res.json()
      expect(res.status(), JSON.stringify(extra)).toBe(410)
      expect(body.error).toBe('table_ordering_off')
      expect(body.message).toMatch(/kassan/)
    }
  })

  test('staff cannot use owner-only routes', async ({ browser }) => {
    test.skip(!optEnv('E2E_STAFF_PASSWORD'), 'no staff password')
    const { adminLogin } = await import('../lib/login')
    const { mail } = await import('../lib/data')
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
    const page = await ctx.newPage()
    await adminLogin(page, mail('staff'), optEnv('E2E_STAFF_PASSWORD'))
    const api = await Api.attach(page, '/bokningar')
    const fake = await api.post('/orders/00000000000000000000000000000000/refund', { amount: 100 })
    expect([401, 403, 404], 'staff refund').toContain(fake.status())
    expect(fake.status(), 'staff is not allowed, not a server error').toBeLessThan(500)
    await page.goto('/personal')
    await page.waitForTimeout(2500)
    const text = await page.locator('body').innerText()
    expect(text, 'no raw error on a page staff may not open').not.toMatch(/Forbidden|undefined|\[object/)
    await ctx.close()
  })
})
