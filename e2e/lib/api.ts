import type { Page, APIResponse } from '@playwright/test'

/**
 * Direct API calls as the signed-in user, for adversarial checks (races,
 * double submits) the UI can't produce. The bearer token is taken from the
 * page's own API traffic; nothing is stored.
 */
export class Api {
  token = ''
  base = ''
  locationId = ''
  constructor(private page: Page) {}

  static async attach(page: Page, path = '/bokningar'): Promise<Api> {
    const api = new Api(page)
    const got = new Promise<void>((resolve) => {
      page.on('request', (r) => {
        const auth = r.headers()['authorization']
        const m = r.url().match(/^(.*?\/api)\/locations\/([0-9a-z]+)\//)
        if (auth && m && !api.token) {
          api.token = auth
          api.base = m[1]
          api.locationId = m[2]
          resolve()
        }
      })
    })
    await page.goto(path)
    await got
    return api
  }

  private h() {
    return { Authorization: this.token, 'Content-Type': 'application/json' }
  }
  loc(p: string) {
    return `${this.base}/locations/${this.locationId}${p}`
  }
  get(p: string): Promise<APIResponse> {
    return this.page.request.get(this.loc(p), { headers: this.h() })
  }
  post(p: string, data: unknown): Promise<APIResponse> {
    return this.page.request.post(this.loc(p), { headers: this.h(), data })
  }
  patch(p: string, data: unknown): Promise<APIResponse> {
    return this.page.request.patch(this.loc(p), { headers: this.h(), data })
  }
}

/** Date in Stockholm, n days ahead, YYYY-MM-DD. */
export function stockholmDate(n = 0): string {
  const d = new Date(Date.now() + n * 86400000)
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}
