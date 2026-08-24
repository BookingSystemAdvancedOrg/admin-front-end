# admin-front-end

Admin frontend for the reservation platform.

## Local development

```bash
npm install
cp .env.example .env   # fill in the Cognito values, see docs/API-OCH-NYCKLAR.md
npm run dev
```

The Vite dev server starts at `http://localhost:5173`.

## Documentation

- [docs/ADMIN.md](docs/ADMIN.md) — the admin app: pages, code structure, auth flow overview.
- [docs/ANVANDARE.md](docs/ANVANDARE.md) — the future guest/customer-facing app (not started yet).
- [docs/API-OCH-NYCKLAR.md](docs/API-OCH-NYCKLAR.md) — every environment variable, key, and API integration (Cognito today, backend API later), plus CI/CD config and troubleshooting.

## Project structure

Each feature lives in its own folder under `src/features/`; shared UI (the
admin shell) lives in `src/shared/`.

```
src/
  features/
    auth/           # login, new-password, Cognito + mock auth
    oversikt/       # dashboard (Figma: admin-oversikt-page)
    bokningar/      # placeholder — next up
    meny/           # placeholder
    layout-editor/  # placeholder
    installningar/  # placeholder
  shared/           # AdminLayout (sidebar), AdminTopbar, admin.css
  App.tsx           # protected admin routes
  main.tsx          # router + auth provider
```

## Authentication

Staff sign-in is handled by AWS Cognito (`/logga-in` and `/nytt-losenord`).
Setup, required keys, and the invite flow are documented in
[docs/API-OCH-NYCKLAR.md](docs/API-OCH-NYCKLAR.md).

```bash
npm run lint
npm run build
```

`npm run build` emits a Vite `dist/` folder (`dist/index.html` plus hashed assets) that CI deploys to S3.

## CI/CD

Two workflows, `dev.yml` (branch `dev`) and `prod.yml` (branch `main`), both calling the shared `reusable_cicd.yml`. Authenticates to AWS via GitHub OIDC.

- **PR into `dev` or `main`** → install/lint/test/build only.
- **Push to `dev`** → build and deploy to the dev S3/CloudFront stack.
- **Push to `main`** → same, against prod.

Non-secret deploy config lives in `.github/config/project.env`.
