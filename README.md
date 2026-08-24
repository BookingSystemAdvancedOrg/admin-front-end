# admin-front-end

Admin frontend for the reservation platform.

## Local development

```bash
npm install
cp .env.example .env   # fill in the Cognito values, see docs/COGNITO-SETUP.md
npm run dev
```

The Vite dev server starts at `http://localhost:5173`.

## Project structure

Each feature lives in its own folder under `src/features/`; shared UI (the
admin shell) lives in `src/shared/`.

```
src/
  features/
    auth/           # login, new-password, Cognito + mock auth
    oversikt/       # dashboard (Figma: admin-oversikt-page)
    bokningar/      # bookings table (Figma: admin-bokningar-page)
    meny/           # menu management (Figma: admin-meny-page)
    layout-editor/  # 3D live layout editor (Figma: admin-live-layout-editor-page)
    installningar/  # settings (Figma: admin-installningar-page)
  shared/           # AdminLayout (sidebar), AdminTopbar, admin.css, api.ts
  App.tsx           # protected admin routes
  main.tsx          # router + auth provider
```

## Data

All admin pages currently run on mock data (`src/features/*/data.ts`).
How to connect the real backend, and where every real key belongs, is
documented in [docs/BACKEND-KOPPLING.md](docs/BACKEND-KOPPLING.md).

## Authentication

Staff sign-in is handled by AWS Cognito (`/logga-in` and `/nytt-losenord`).
Setup, required keys, and the invite flow are documented in
[docs/COGNITO-SETUP.md](docs/COGNITO-SETUP.md).

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
