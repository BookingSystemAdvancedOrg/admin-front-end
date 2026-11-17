import { test, expect, type Page } from '@playwright/test'
import { ready } from '../lib/ui'
import { optEnv } from '../lib/env'
import { Api } from '../lib/api'

/**
 * Guest refunds on a pickup order paid with Stripe's test card (made by
 * 60-orders). Owner only; the amount is capped at what is left; a double click
 * refunds once; the reason and "Meddela gästen" are there. Stripe TEST mode only.
 */
test.use({ storageState: '.auth/pizza.json' })
test.describe.configure({ mode: 'default' })
test.skip(!optEnv('E2E_PIZZA_OWNER_EMAIL'), 'no Stripe-ready order-test restaurant configured')

const refundButton = (page: Page) => page.getByRole('button', { name: /^Återbetala/ })

async function openRefund(page: Page) {
  await page.goto('/bestallningar')
  await ready(page, 'Beställningar')
  const done = page.getByText(/^Avslutade idag/)
  if (await done.count()) await done.first().click().catch(() => {})
  await expect(refundButton(page).first(), 'an order paid with the test card can be refunded').toBeVisible({ timeout: 60000 })
  await refundButton(page).first().click()
  return page.getByRole('dialog', { name: /^Återbetala #/ })
}

const left = async (dlg: ReturnType<Page['getByRole']>) =>
  ((await dlg.locator('.refund-left').innerText()).match(/([\d\s]+(?:,\d+)?)\s*kr/)?.[1] ?? '').replace(/\s/g, '').replace(',', '.')

test('refund dialog: capped amount, reason, Meddela gästen, bad input explained', async ({ page }, info) => {
  const dlg = await openRefund(page)
  await expect(dlg).toBeVisible()
  await expect(dlg.getByLabel('Belopp (kr)')).toBeFocused()
  await expect(dlg.getByLabel('Anledning (valfri)')).toBeVisible()
  await expect(dlg.getByRole('checkbox', { name: 'Meddela gästen' })).toBeChecked()
  const total = Number(await left(dlg))
  expect(total).toBeGreaterThan(0)
  const amount = dlg.getByLabel('Belopp (kr)')
  const confirm = dlg.locator('.refund-confirm')
  for (const bad of ['0', 'abc', '-5', String(total + 1), '']) {
    await amount.fill(bad)
    await expect(confirm, `"${bad}" cannot be sent`).toBeDisabled()
  }
  await amount.fill(String(total + 1))
  await expect(dlg.locator('.refund-summary')).toContainText(/Ange ett belopp/)
  await dlg.screenshot({ path: info.outputPath('refund-dialog.png') })
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
})

test('partial refund with reason, double click refunds once, then the rest, then nothing left', async ({ page }, info) => {
  const dlg = await openRefund(page)
  const before = Number(await left(dlg))
  await dlg.getByLabel('Belopp (kr)').fill('10')
  await dlg.getByLabel('Anledning (valfri)').fill('E2E: kall pizza')
  const confirm = dlg.locator('.refund-confirm')
  await expect(confirm).toHaveText(/Återbetala 10 kr/)
  await confirm.dblclick() // double click: one refund
  await expect(dlg).toBeHidden({ timeout: 30000 })
  await expect(page.getByText(/Delvis återbetald 10 kr/).first()).toBeVisible({ timeout: 20000 })

  const dlg2 = await openRefund(page)
  expect(Number(await left(dlg2)), 'exactly 10 kr went back, not 20').toBeCloseTo(before - 10, 2)
  await dlg2.screenshot({ path: info.outputPath('refund-second.png') })
  await dlg2.getByLabel('Belopp (kr)').fill(String(before - 10 + 5))
  await expect(dlg2.locator('.refund-confirm'), 'more than what is left').toBeDisabled()

  // the API refuses it too (an old tab, a script)
  const api = await Api.attach(page, '/bestallningar')
  const list = await (await api.get('/orders')).json()
  const orders: { orderId: string; refundable?: number; customerName?: string }[] = list.orders ?? list.items ?? list
  const mine = orders.find((o) => (o.refundable ?? 0) > 0 && /E2E/.test(o.customerName ?? ''))
  expect(mine, 'the E2E order is in the list').toBeTruthy()
  const over = await api.post(`/orders/${mine!.orderId}/refund`, { amount: (mine!.refundable ?? 0) + 100 })
  expect(over.status(), 'refund above what is left is refused').toBeGreaterThanOrEqual(400)
  expect(over.status()).toBeLessThan(500)

  // two refunds of the rest in parallel: one wins, the other is refused
  const rest = mine!.refundable!
  const both = await Promise.all([0, 1].map(() => api.post(`/orders/${mine!.orderId}/refund`, { amount: rest })))
  const codes = both.map((r) => r.status()).sort()
  info.annotations.push({ type: 'parallel refund statuses', description: codes.join(', ') })
  expect(codes.filter((c) => c < 300), 'exactly one parallel refund goes through').toHaveLength(1)
  expect(codes.filter((c) => c >= 400 && c < 500), 'the other is refused (409), not a 500').toHaveLength(1)
  const again = await api.post(`/orders/${mine!.orderId}/refund`, { amount: 100 })
  expect(again.status(), 'nothing left to refund').toBe(409)
  expect((await again.json()).error).toMatch(/nothing_to_refund|not_refundable/)
})
