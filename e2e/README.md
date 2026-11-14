# Admin + guest end-to-end tests (live dev)

Playwright specs that drive the real dev environment: restaurant admin
(`restaurang.dev.booqy.se`), the guest site and the dev API. They create and
use an `E2E` test restaurant; everything they make starts with `E2E`.

Never point them at prod (the config refuses `restaurang.booqy.se`).

## Run

```bash
npm ci
npx playwright install chromium webkit
npm test                      # setup + chromium + iphone (WebKit) + tablet
npx playwright test --project=chromium
npx playwright test --project=iphone      # Safari engine, @mobile and @webkit tests
node summarize.mjs            # one line per test from test-results/results.json
```

## Settings (env vars, or a local file outside git)

The suite reads `E2E_*` values from the environment, or from the file in
`E2E_ENV_FILE` (default `../../.e2e-credentials.env`, the folder that holds
the repos). Never commit that file.

| Name | What |
| --- | --- |
| `E2E_ADMIN_URL` | admin base URL, default `https://restaurang.dev.booqy.se` |
| `E2E_API_URL` | dev API, used by the local guest site |
| `E2E_GUEST_URL` | dev CloudFront host for menu images |
| `E2E_OWNER_EMAIL`, `E2E_OWNER_PASSWORD` | owner of the E2E restaurant |
| `E2E_STAFF_PASSWORD` | the invited E2E staff member (optional) |
| `E2E_PIZZA_OWNER_EMAIL`, `E2E_PIZZA_OWNER_PASSWORD` | an E2E owner on a restaurant whose Stripe is ready (orders, optional) |
| `E2E_ORDER_SLUG` | that restaurant's slug, default `test-pizza` |

The E2E restaurant is created by the console suite
(`booqy-console/e2e`, `10-new-customer.e2e.ts`).

## Notes

- The guest site runs locally from `../../customer-front-end` against the dev
  API (Playwright starts it on port 7181), so Stripe's test card is only typed
  on a localhost page. `E2E_NO_GUEST=1` skips that server.
- `60-orders.e2e.ts` opens ordering and today's hours on the order-test
  restaurant for the run, adds E2E dishes, and puts everything back after.
- Phone numbers are from the PTS range reserved for fiction (070-174 06 05);
  e-mails go to the SES mailbox simulator. No real person is contacted.
