import { expect, type Page } from '@playwright/test'

/** Wait until the admin page has rendered its heading and no loading receipt is left. */
export async function ready(page: Page, heading?: string | RegExp) {
  if (heading) await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await expect(page.locator('.printing, [aria-busy=true]')).toHaveCount(0, { timeout: 30000 }).catch(() => {})
}

/** A toast, status or alert containing the text. */
export const notice = (page: Page, text: string | RegExp) =>
  page.locator('[role=status], [role=alert], .toast').filter({ hasText: text }).first()
