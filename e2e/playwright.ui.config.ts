import { defineConfig, devices } from '@playwright/test'
import { CROSS_BROWSER } from './lib/ui-audit'

/**
 * UI suite (layout, accessibility, visual regression) at every common screen
 * size, against the local dev server on mock data (VITE_API_BASE_URL unset,
 * mock login). Never touches a live environment. `npm run test:ui`.
 * Chromium runs every size; WebKit and Firefox run a phone, a tablet and a
 * desktop size (tests tagged @x). Baselines: e2e/ui-baselines (chromium only).
 */
const PORT = Number(process.env.UI_PORT ?? 7070)

export default defineConfig({
  testDir: 'ui',
  testMatch: /\.ui\.ts$/,
  timeout: 90_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, threshold: 0.2, animations: 'disabled', caret: 'hide' } },
  fullyParallel: true,
  workers: Number(process.env.UI_WORKERS ?? 4),
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/ui-results.json' }]],
  outputDir: 'test-results/ui',
  snapshotPathTemplate: 'ui-baselines/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'sv-SE',
    timezoneId: 'Europe/Stockholm',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_API_BASE_URL: '' },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@x/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@x/ },
  ],
})
void CROSS_BROWSER
