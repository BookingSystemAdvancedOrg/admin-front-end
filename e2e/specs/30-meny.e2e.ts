import { test, expect, type Page } from '@playwright/test'
import { watch } from '../lib/watch'
import { ready } from '../lib/ui'
import { options, pick } from '../lib/select'
import { RUN, uniq } from '../lib/data'
import { Api } from '../lib/api'

const IMG = 'fixtures/dish.jpg'
/** 2:1, wider than the 4:3 focus frame. */
const WIDE_IMG = 'fixtures/dish-wide.jpg'

type Item = { menuItemId: string; name: string }

/** Reloads Meny and reads the location's menu items with the page's own token. */
async function menuItems(page: Page): Promise<{ api: Api; items: Item[] }> {
  const api = await Api.attach(page, '/meny')
  await ready(page, 'Meny')
  const res = await api.get('/menu/items')
  expect(res.ok(), `list menu items: ${res.status()}`).toBe(true)
  return { api, items: ((await res.json()).items ?? []) as Item[] }
}

async function addDish(page: Page, d: { name: string; category: string; price: string; desc?: string; alcohol?: boolean; parts?: [string, string][]; image?: string }) {
  await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
  const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
  await expect(dlg).toBeVisible()
  await dlg.locator('input[type=file]').setInputFiles(d.image ?? IMG)
  await dlg.getByLabel('Namn').fill(d.name)
  if (d.desc) await dlg.getByLabel('Beskrivning (frivilligt)').fill(d.desc)
  await pick(dlg.getByLabel('Kategori'), { label: d.category })
  await dlg.getByLabel('Pris (kr)').fill(d.price)
  if (d.alcohol) await dlg.getByRole('switch', { name: 'Innehåller alkohol' }).click()
  for (const [i, [part, station]] of (d.parts ?? []).entries()) {
    await dlg.getByRole('button', { name: i === 0 ? 'Dela upp som meny/combo' : 'Lägg till del' }).click()
    await dlg.locator(`#dish-part-${i}`).fill(part)
    if (station) await pick(dlg.locator(`#dish-part-station-${i}`), { label: station })
  }
  await dlg.getByRole('button', { name: 'Lägg till rätt' }).click()
  await expect(dlg).toBeHidden({ timeout: 30000 })
  await expect(page.getByRole('row', { name: new RegExp(d.name.slice(0, 20)) }).first()).toBeVisible()
}

test.describe('Admin: Meny', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/meny')
    await ready(page, 'Meny')
  })

  test('photo is optional: a drink can be added without one', async ({ page }) => {
    await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
    const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
    await dlg.getByLabel('Namn').fill('E2E Cola')
    await dlg.getByLabel('Pris (kr)').fill('35')
    await expect(dlg.getByRole('button', { name: 'Lägg till rätt' })).toBeEnabled()
    await dlg.getByRole('button', { name: 'Avbryt' }).click()
  })

  test('menu editor offers allergens, add-ons (modifiers) and own categories', async ({ page }) => {
    await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
    const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
    await expect.soft(dlg.getByRole('group', { name: 'Allergener' }), 'allergen field').toBeVisible()
    await expect.soft(dlg.getByRole('group', { name: 'Tillval' }), 'add-ons / modifiers field').toBeVisible()
    await expect.soft(dlg.getByRole('button', { name: 'Lägg till tillval' })).toBeVisible()
    await dlg.getByRole('button', { name: 'Avbryt' }).click()
    // Own category: add E2E Pizzor, see it in the dish form, then remove it again.
    const cat = `E2E Pizzor ${RUN}`
    const openCats = async () => {
      await page.getByRole('button', { name: 'Kategorier', exact: true }).click()
      const d = page.getByRole('dialog', { name: 'Kategorier' })
      await expect(d).toBeVisible()
      return d
    }
    let cats = await openCats()
    await cats.getByLabel('Ny kategori').fill(cat)
    await cats.getByRole('button', { name: 'Lägg till', exact: true }).click()
    await cats.getByRole('button', { name: 'Spara kategorier' }).click()
    await expect(cats).toBeHidden({ timeout: 20000 })
    await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
    const catNames = await options(dlg.getByLabel('Kategori'))
    test.info().annotations.push({ type: 'categories', description: catNames.join(', ') })
    expect.soft(catNames, 'restaurant can add its own categories').toContain(cat)
    await dlg.getByRole('button', { name: 'Avbryt' }).click()
    cats = await openCats()
    await cats.getByRole('button', { name: `Ta bort ${cat}` }).click()
    await cats.getByRole('button', { name: 'Spara kategorier' }).click()
    await expect(cats).toBeHidden({ timeout: 20000 })
  })

  test('create dishes: food, drink, combo split, long name with emoji and åäö', async ({ page }, info) => {
    test.skip((await page.getByRole('row', { name: /E2E Burgermeny/ }).count()) > 0, 'menu already created')
    const w = watch(page)
    await addDish(page, { name: 'E2E Smörstekt torskrygg åäö', category: 'Varmrätter', price: '245', desc: 'Innehåller fisk, mjölk. Allergi: nötter i såsen' })
    await addDish(page, { name: 'E2E Toast Skagen', category: 'Förrätter', price: '145' })
    await addDish(page, { name: 'E2E Chokladfondant', category: 'Efterrätter', price: '115' })
    await addDish(page, { name: 'E2E Lättöl', category: 'Drycker', price: '49' })
    await addDish(page, { name: 'E2E Husets vin', category: 'Drycker', price: '125', alcohol: true })
    await addDish(page, { name: 'E2E Burgermeny', category: 'Varmrätter', price: '189', parts: [['Burgare', ''], ['Pommes', ''], ['Läsk', 'Ingen bong']] })
    await addDish(page, { name: 'E2E 🍕🔥 Väldigt långt namn på en pizza med extra allt och lite till för att testa radbrytning', category: 'Varmrätter', price: '199' })
    await page.screenshot({ path: info.outputPath('menu.png'), fullPage: true })
    await w.attach(info)
    expect(w.failed, w.failed.join('\n')).toEqual([])
  })

  test('price validation: negative, text, huge', async ({ page }) => {
    await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
    const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
    for (const bad of ['-10', 'abc', '99999999']) {
      await dlg.getByLabel('Pris (kr)').fill(bad)
      await expect.soft(dlg.locator('#dish-price-error'), `price "${bad}" should be refused (else it is saved as ${bad === 'abc' ? '0' : bad === '-10' ? '10' : 'huge'} kr)`).toBeVisible({ timeout: 2000 })
    }
    await dlg.getByRole('button', { name: 'Avbryt' }).click()
  })

  test('row click opens edit, focal point drag, lightbox, save @webkit', async ({ page }) => {
    // Own dish per run (and project), removed again at the end, so earlier runs never leave
    // two rows or two lightbox buttons with the same name. The photo is 2:1 in a 4:3 frame,
    // so there is room to drag the focal point sideways.
    const name = `E2E Toast ${RUN} ${uniq()}`
    try {
      await addDish(page, { name, category: 'Förrätter', price: '145', image: WIDE_IMG })
      await page.getByRole('row', { name: new RegExp(name) }).click()
      const dlg = page.getByRole('dialog', { name: 'Redigera rätt' })
      await expect(dlg).toBeVisible()
      const frame = dlg.locator('.dish-focus-frame')
      await expect(frame.locator('img')).toHaveJSProperty('complete', true)
      const box = await frame.boundingBox()
      expect(box, 'focus frame is on screen').toBeTruthy()
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 4, box.y + box.height / 4, { steps: 8 })
        await page.mouse.up()
      }
      await expect(dlg.getByRole('button', { name: 'Återställ' }), 'dragging the photo moves the focal point').toBeEnabled({ timeout: 3000 })
      await dlg.getByLabel('Pris (kr)').fill('149')
      await dlg.getByRole('button', { name: 'Spara ändringar' }).click()
      await expect(dlg).toBeHidden({ timeout: 20000 })
      await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('149')
      await page.getByRole('button', { name: `Visa bilden på ${name}` }).click()
      await expect(page.locator('.lightbox, [class*=lightbox]').first()).toBeVisible()
      await page.keyboard.press('Escape')
    } finally {
      const { api, items } = await menuItems(page)
      const mine = items.filter((d) => d.name === name)
      expect.soft(mine, 'the dish this test made').toHaveLength(1)
      for (const d of mine) {
        const res = await api.del(`/menu/items/${encodeURIComponent(d.menuItemId)}`)
        expect.soft(res.ok(), `delete ${d.name}: ${res.status()}`).toBe(true)
      }
    }
  })

  test('toggle status off and on persists @webkit', async ({ page }) => {
    // Inactive dishes move down the list, so count switches instead of following one row.
    const on = () => page.locator('[role=switch][aria-label="E2E Chokladfondant aktiv"][aria-checked=true]')
    const off = () => page.locator('[role=switch][aria-label="E2E Chokladfondant aktiv"][aria-checked=false]')
    if ((await on().count()) === 0) await off().first().click()
    await expect(on().first()).toBeVisible()
    const before = await on().count()
    const saved = page.waitForResponse((r) => /\/menu/.test(r.url()) && ['PATCH', 'PUT', 'POST'].includes(r.request().method()), { timeout: 15000 }).catch(() => null)
    await on().first().click()
    await expect(on()).toHaveCount(before - 1)
    const res = await saved
    test.info().annotations.push({ type: 'save request', description: res ? `${res.request().method()} ${res.status()}` : 'none sent within 15 s' })
    await page.reload()
    await ready(page, 'Meny')
    await expect(on()).toHaveCount(before - 1)
    await off().first().click()
    await expect(on()).toHaveCount(before)
  })

  test('double click on save creates one dish, not two', async ({ page }) => {
    await page.getByRole('button', { name: '+ Lägg till rätt' }).click()
    const dlg = page.getByRole('dialog', { name: 'Lägg till rätt' })
    await dlg.locator('input[type=file]').setInputFiles(IMG)
    await dlg.getByLabel('Namn').fill(`E2E Dubbelklick ${RUN}`)
    await dlg.getByLabel('Pris (kr)').fill('10')
    await dlg.getByRole('button', { name: 'Lägg till rätt' }).dblclick()
    await expect(dlg).toBeHidden({ timeout: 20000 })
    await page.reload()
    await ready(page, 'Meny')
    await expect(page.getByRole('row', { name: new RegExp(`E2E Dubbelklick ${RUN}`) })).toHaveCount(1)
  })
})
