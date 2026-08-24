# admin-front-end

Admin frontend for the reservation platform.

## Local development

```bash
npm install
cp .env.example .env   # fill in the Cognito values, see docs/COGNITO-SETUP.md
npm run dev
```

The Vite dev server starts at `http://localhost:5173`.

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
