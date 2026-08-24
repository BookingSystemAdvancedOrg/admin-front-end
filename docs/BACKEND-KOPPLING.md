# Backend-koppling — mockdata idag, riktigt API sen

Alla admin-sidor är byggda och fungerar, men kör på **mockdata**. Det här dokumentet beskriver var mockdatan bor, hur den byts mot riktiga API-anrop, och exakt var alla riktiga nycklar ska ligga när backend är på plats.

## 1. Läget just nu

| Sida | Mockdata | Framtida API-anrop (förslag) |
| --- | --- | --- |
| Översikt | `src/features/oversikt/OversiktPage.tsx` (inline) | `GET /dashboard` |
| Bokningar | `src/features/bokningar/data.ts` | `GET /reservations` |
| Meny | `src/features/meny/data.ts` | `GET/POST/PUT/DELETE /menu` |
| Layout-editorn | `src/features/layout-editor/data.ts` | `GET /layout`, `PUT /layout` (publicera) |
| Inställningar | `src/features/installningar/data.ts` | `GET/PUT /settings`, `GET /staff` |

Mönstret: varje feature har sin `data.ts` med typer + mockkonstanter. Typerna behålls när API:t kopplas — det är bara datakällan som byts. Ändringar man gör i gränssnittet (toggla rätter, flytta bord, spara inställningar) lever i webbläsarens minne och försvinner vid omladdning — det är väntat tills backend finns.

## 2. Så byts mock mot API

Hjälparen `src/shared/api.ts` är redan förberedd. Den läser `VITE_API_BASE_URL`, hämtar inloggningens ID-token från Cognito och skickar den som `Authorization: Bearer <token>`:

```ts
// features/bokningar/BokningarPage.tsx — från:
const reservations = MOCK_RESERVATIONS

// — till:
import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/api'
import type { Reservation } from './data'

const [reservations, setReservations] = useState<Reservation[]>([])
useEffect(() => {
  apiFetch<Reservation[]>('/reservations').then(setReservations)
}, [])
```

Backend (API Gateway) validerar tokenen med en **Cognito authorizer** — se avsnitt 6 i `docs/COGNITO-SETUP.md`.

## 3. Var de riktiga nycklarna ska ligga

### Frontend (detta repo) — bara publika värden

Frontendens "nycklar" är inga hemligheter: allt som byggs in i bundeln kan läsas av vem som helst som öppnar sidan. Här ska bara ligga:

| Värde | Lokalt (din dator) | Deploy (CI) |
| --- | --- | --- |
| `VITE_COGNITO_USER_POOL_ID` | `.env` i projektroten | `.github/config/project.env` → `VITE_COGNITO_USER_POOL_ID_DEV` / `_PROD` |
| `VITE_COGNITO_CLIENT_ID` | `.env` | `project.env` → `VITE_COGNITO_CLIENT_ID_DEV` / `_PROD` |
| `VITE_API_BASE_URL` | `.env`, t.ex. `https://xxxx.execute-api.eu-north-1.amazonaws.com/dev` | läggs till i `project.env` som `VITE_API_BASE_URL_DEV` / `_PROD` när API:t finns (se nedan) |

`.env` är git-ignorerad och stannar på din dator. `project.env` är committad — det är okej just för att värdena är publika. Vite bakar in värdena vid **byggtillfället**: starta om `npm run dev` efter ändring, och i CI byggs de in av bygg-steget.

När API-URL:en finns: lägg till raderna i `.github/config/project.env` och komplettera `reusable_cicd.yml` på samma sätt som Cognito-värdena redan hanteras (config-jobbet läser `VITE_API_BASE_URL_${SUFFIX}` och bygg-steget får `VITE_API_BASE_URL` i `env:`).

### Backend (AWS) — här bor de riktiga hemligheterna

Dessa får **aldrig** hamna i frontend, `.env`, `project.env` eller någon annanstans i det här repot:

| Hemlighet | Rätt plats |
| --- | --- |
| Stripe **secret key** (`sk_live_…`) | AWS Secrets Manager, läses av Lambda. (Stripes *publishable key* `pk_…` är däremot okej i frontend om det behövs.) |
| Databas-uppgifter (DynamoDB/RDS) | Lambdans IAM-roll respektive Secrets Manager — frontend pratar aldrig direkt med databasen. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Ingenstans i detta repo. CI autentiserar redan nyckellöst via GitHub OIDC, och Lambdas får rättigheter via IAM-roller. |
| Cognito app-klient **med** secret (server-side) | Endast i backend, om en sådan behövs. Frontendens klient är en publik klient utan secret. |
| Tredjeparts-API-nycklar (SMS, e-post m.m.) | Lambda-miljövariabler eller Secrets Manager. |

Tumregel: frontend skickar bara sin JWT. Allt som kan spendera pengar eller läsa data ligger bakom API Gateway + Cognito authorizer, och dess hemligheter bor i AWS.

## 4. Checklista när backend kopplas på

1. Skapa API:t i API Gateway med Cognito authorizer mot samma User Pool, och CORS för er frontend-domän (+ `http://localhost:5173` för dev).
2. Sätt `VITE_API_BASE_URL` i din lokala `.env` och verifiera mot dev-API:t.
3. Lägg till `VITE_API_BASE_URL_DEV`/`_PROD` i `project.env` + bygg-steget i workflown.
4. Byt sida för sida från `MOCK_…` till `apiFetch(...)` enligt mönstret i avsnitt 2 — typerna i `data.ts` återanvänds som API-kontrakt.
5. Ta bort mockkonstanterna när respektive sida är kopplad (eller behåll dem för Storybook/tester).
6. Glöm inte: dev-inloggningen `test@test.se` (`features/auth/mockAuth.ts`) finns bara i `npm run dev` och följer aldrig med i produktionsbygget.
