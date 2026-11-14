import { test as base, type BrowserContext } from '@playwright/test'
import { adminLogin } from './login'
import { env } from './env'

/**
 * Deployed dev admin with real data, read-only. One signed-in context per
 * worker (the refresh cookie rotates, so every test of a worker reuses it).
 */
export const test = base.extend<object, { ctx: BrowserContext }>({
  ctx: [async ({ browser }, use) => {
    const c = await browser.newContext({ baseURL: env('E2E_ADMIN_URL', 'https://restaurang.dev.booqy.se'), locale: 'sv-SE', timezoneId: 'Europe/Stockholm', reducedMotion: 'reduce' })
    const p = await c.newPage()
    await adminLogin(p)
    await p.close()
    await use(c)
    await c.close()
  }, { scope: 'worker' }],
  page: async ({ ctx }, use) => {
    const p = await ctx.newPage()
    await use(p)
    await p.close()
  },
})
