# Admin-panelen

Allt som handlar om admin-appen (personal & ägare) — sidor, kodstruktur och
inloggningsflödet. För miljövariabler, nycklar och Cognito-uppsättning, se
[API-OCH-NYCKLAR.md](API-OCH-NYCKLAR.md). För den kommande gäst/kund-vända
appen, se [ANVANDARE.md](ANVANDARE.md).

## 1. Vad är det här?

En Vite + React (TypeScript) SPA för personal och ägare på restaurangen att
hantera bokningar, meny, bordslayout och inställningar. Byggs och deployas via
GitHub Actions till S3 + CloudFront (se README.md).

## 2. Projektstruktur

Varje funktionsområde ligger i sin egen mapp under `src/features/`. Delad UI
(sidebar, topbar) ligger i `src/shared/`.

```
src/
  features/
    auth/            # Inloggning, nytt lösenord, Cognito + mock-auth
    oversikt/        # Dashboard (Figma: admin-oversikt-page) — klar
    bokningar/        # Platshållare — bokningslistan byggs härnäst
    meny/             # Platshållare
    layout-editor/    # Platshållare
    installningar/    # Platshållare
  shared/
    AdminLayout.tsx   # Sidebar + sidram (Figma: admin-sidebar)
    AdminTopbar.tsx   # Sidhuvud i högerkolumnen (Figma: admin-topbar)
    admin.css         # All styling för admin-skalet
  App.tsx             # Skyddade admin-routes (renderas inuti RequireAuth)
  main.tsx            # Toppnivå-router: /logga-in, /nytt-losenord, appen
  index.css           # Globala CSS-variabler (färger, typsnitt) och resets
```

## 3. Sidor

| Route | Sida | Status |
| --- | --- | --- |
| `/` | Översikt (`OversiktPage`) | Klar — nyckeltal, dagens bokningar, aktivitetsflöde, genvägar. Data är just nu hårdkodad demo-data i komponenten; ska ersättas med anrop mot backend-API:t (se API-OCH-NYCKLAR.md). |
| `/bokningar` | Bokningar (`BokningarPage`) | Platshållare — byggs härnäst. |
| `/meny` | Meny (`MenyPage`) | Platshållare. |
| `/layout` | Layout (`LayoutEditorPage`) | Platshållare — live layout-editor för bord. |
| `/installningar` | Inställningar (`InstallningarPage`) | Platshållare — bl.a. tänkt för att bjuda in personal. |

Okända sökvägar (`*`) skickas tillbaka till `/` istället för att visa en
404-sida (se `src/App.tsx`).

## 4. Inloggning (kort version)

Personal loggar in på `/logga-in` mot AWS Cognito direkt från webbläsaren
(ingen egen backend för själva inloggningen). Full kodgenomgång, felsökning
och Cognito-uppsättning finns i [API-OCH-NYCKLAR.md](API-OCH-NYCKLAR.md) —
här är bara flödet:

1. `main.tsx` renderar `/logga-in` och `/nytt-losenord` fritt; alla andra
   sökvägar går genom `RequireAuth`, som skickar utloggade till `/logga-in`.
2. `AuthProvider` (`src/features/auth/AuthContext.tsx`) håller status
   (`loading` / `signed-out` / `signed-in`) och exponerar `login`,
   `finishNewPassword`, `logout` och `getToken` via `useAuth()`.
3. Ett konto som precis blivit inbjudet har ett tillfälligt lösenord →
   Cognito svarar med `NEW_PASSWORD_REQUIRED` → appen skickar automatiskt
   personen till `/nytt-losenord`.
4. I `npm run dev` finns även en mock-inloggning (`test@test.se` /
   `test1234`, se `src/features/auth/mockAuth.ts`) så man kan jobba med
   admin-panelen utan att Cognito är konfigurerat. Den koden är helt borta i
   `npm run build` (styrs av `import.meta.env.DEV`).

## 5. Att koppla på riktigt data

`OversiktPage` (och sedan de andra sidorna) använder just nu hårdkodade
konstanter (`STATS`, `TODAYS_BOOKINGS`, `ACTIVITY`, `QUICK_LINKS`) som
demo-data. När backend-API:t finns, ersätt dessa med `fetch`/`useEffect` (eller
ett data-fetching-bibliotek) mot API:t, autentiserat med token från
`useAuth().getToken()` — se exempel i
[API-OCH-NYCKLAR.md](API-OCH-NYCKLAR.md#anropa-ert-api-med-inloggningen).

## 6. Deploy

Se README.md för CI/CD-översikten (GitHub Actions → S3 + CloudFront, `dev`
och `main`-grenarna). Deploy-konfiguration (bucket-namn, roll-ARN:er,
CloudFront-ID:n) beskrivs i
[API-OCH-NYCKLAR.md](API-OCH-NYCKLAR.md#cicd-konfiguration-ej-hemligt).
