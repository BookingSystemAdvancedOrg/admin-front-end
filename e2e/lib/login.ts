import { expect, type Page } from '@playwright/test'
import { env } from './env'

/** Restaurant admin sign-in (owner or staff). */
export async function adminLogin(page: Page, email?: string, password?: string) {
  await page.goto('/logga-in')
  await page.getByLabel('E-post').fill(email ?? env('E2E_OWNER_EMAIL'))
  await page.getByLabel('Lösenord').fill(password ?? env('E2E_OWNER_PASSWORD'))
  await page.getByRole('button', { name: 'Logga in' }).click()
  await expect(page).not.toHaveURL(/logga-in/, { timeout: 30000 })
  // The welcome tour opens on every new browser until skipped there.
  const skip = page.getByRole('button', { name: 'Hoppa över' })
  if (await skip.waitFor({ timeout: 6000 }).then(() => true, () => false)) await skip.click()
}
