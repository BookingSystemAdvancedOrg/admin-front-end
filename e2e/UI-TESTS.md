# Admin UI tests (layout, accessibility, visual)

Two Playwright suites for the restaurant admin, next to the live-dev e2e specs.

1. `npm run test:ui` runs against the local Vite dev server on mock data
   (`VITE_API_BASE_URL` unset, mock login). Deterministic: this suite owns the
   visual baselines. Pages that need an API show their "no API" state here.
2. `npm run test:ui:live` runs layout and accessibility on every page, plus
   modals and tooltips, against the DEPLOYED DEV admin with real data
   (`E2E_ADMIN_URL`, owner credentials from the uncommitted env file, see
   README.md). Read only: it navigates and opens dialogs, never saves. The
   config refuses prod.

```bash
npm ci
npx playwright install chromium webkit firefox
npm run test:ui                         # all sizes, Chromium + WebKit + Firefox (@x)
npx playwright test -c playwright.ui.config.ts --project=chromium -g "meny 390"
npm run test:ui:update                  # rewrite the baselines (review the diff!)
npm run test:ui:live
npm run ui:report                       # ranked findings
```

Both suites start the dev server themselves (port `UI_PORT`, default 7070).
`UI_WORKERS` sets parallelism (default 4, live 3).

## What it checks

Every page x every size x light and dark (where the app has both):

- Sizes (Chromium): 320, 360, 375, 390, 414 (phones), 768 and 820 portrait,
  1024 and 1180 landscape (tablets), 1280, 1440, 1920, 2560 (desktop).
  WebKit (Safari) and Firefox run 390, 820 and 1440 (tests tagged `@x`). The Firefox build that Playwright 1.63 installs on the dev Mac does not start ("Could not find profile folder"), so Firefox has not been run yet; run `--project=firefox` on CI or after a Playwright update.
- Layout (`lib/ui-audit.ts`, identical in all four apps): no sideways page
  scroll, nothing cut off at the window edge, text not clipped, nothing
  covering a button or input, fixed bars, dialogs and drawers inside the window
  (and scrollable if taller), the floating help button overlapping nothing
  (fixed bars anywhere, any content at the end of the page), tap targets of at
  least 44 px on phones (reported as `low`, never fails the run), visible
  keyboard focus on the first tab stops.
- Accessibility: `@axe-core/playwright`, serious and critical only.
- Visual regression: `toHaveScreenshot` at the sizes in `VISUAL`
  (`UI_VISUAL_SIZES`, default `360,1280`, to keep the repo small), animations
  off, reduced motion, fixed clock. Baselines are macOS Chromium; update them
  on a Mac.
- Every test appends its findings to `test-results/ui-issues.jsonl`;
  `node summarize-ui.mjs` ranks them by severity (`--json out.json` for the
  report).

Specs are named `*.ui.ts` so the app's own unit tests never pick them up.
