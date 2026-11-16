import { defineConfig, devices } from '@playwright/test'
import { env } from './lib/env'

/**
 * Admin layout + accessibility at every screen size against the DEPLOYED DEV
 * admin with real data (read-only: only navigation, no saves). One sign-in per
 * worker. No visual baselines here (live data changes). Never prod.
 * `npm run test:ui:live`
 */
const baseURL = env('E2E_ADMIN_URL', 'https://restaurang.dev.booqy.se')
if (/\/\/restaurang\.booqy\.se/.test(baseURL)) throw new Error('Refusing to run against prod')

export default defineConfig({
  testDir: 'ui',
  testMatch: /\.ui-live\.ts$/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: Number(process.env.UI_WORKERS ?? 3),
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/ui-live-results.json' }]],
  outputDir: 'test-results/ui-live',
  use: { baseURL, locale: 'sv-SE', timezoneId: 'Europe/Stockholm', reducedMotion: 'reduce', screenshot: 'only-on-failure', actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@x/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@x/ },
  ],
})
