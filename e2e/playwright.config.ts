import { defineConfig, devices } from '@playwright/test'
import { env } from './lib/env'

/**
 * Booqy admin + guest site end-to-end tests against a live environment (dev).
 * E2E_ADMIN_URL, E2E_GUEST_URL, E2E_API_URL and the test credentials come from
 * env vars or the local, uncommitted file in E2E_ENV_FILE (lib/env.ts).
 * Never point this at prod.
 */
const baseURL = env('E2E_ADMIN_URL', 'https://restaurang.dev.booqy.se')
if (/\/\/restaurang\.booqy\.se/.test(baseURL)) throw new Error('Refusing to run against prod')

export default defineConfig({
  testDir: 'specs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    storageState: '.auth/owner.json',
  },
  // Guest site from the local customer-front-end checkout, against the real dev
  // API: Stripe's test card is only used on a localhost page.
  webServer: process.env.E2E_NO_GUEST ? undefined : {
    command: 'npx vite --port 7181 --strictPort',
    cwd: '../../customer-front-end',
    url: 'http://localhost:7181',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      VITE_API_BASE_URL: env('E2E_API_URL', 'https://dh2m5ildm7.execute-api.eu-north-1.amazonaws.com'),
      VITE_MENU_IMAGE_BASE_URL: env('E2E_GUEST_URL', 'https://d3kaislpxcbglq.cloudfront.net'),
    },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { storageState: { cookies: [], origins: [] } } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'iphone', use: { ...devices['iPhone 15'] }, dependencies: ['setup'], grep: /@mobile|@webkit/ },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' }, dependencies: ['setup'], grep: /@mobile|@webkit/ },
  ],
})
