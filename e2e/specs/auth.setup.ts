import { test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { adminLogin } from '../lib/login'
import { optEnv } from '../lib/env'

async function signIn(page: import('@playwright/test').Page, file: string, email?: string, password?: string) {
  await adminLogin(page, email, password)
  // First login: the welcome tour opens; skip it so deep links work.
  const skip = page.getByRole('button', { name: 'Hoppa över' })
  if (await skip.waitFor({ timeout: 8000 }).then(() => true, () => false)) await skip.click()
  await page.waitForTimeout(1500)
  await page.context().storageState({ path: file })
}

setup('owner signs in and saves the session', async ({ page }) => {
  mkdirSync('.auth', { recursive: true })
  await signIn(page, '.auth/owner.json')
})

setup('order-test restaurant owner signs in', async ({ page }) => {
  setup.skip(!optEnv('E2E_PIZZA_OWNER_EMAIL'), 'no order-test restaurant configured')
  await signIn(page, '.auth/pizza.json', optEnv('E2E_PIZZA_OWNER_EMAIL'), optEnv('E2E_PIZZA_OWNER_PASSWORD'))
})
