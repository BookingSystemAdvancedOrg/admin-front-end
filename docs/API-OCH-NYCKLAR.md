# API:er och nycklar

Alla miljövariabler, nycklar och API-kopplingar för hela projektet samlade på
ett ställe — både de som finns idag (Cognito) och de som kommer längre fram
(ett eget backend-API). För admin-panelens sidor och kodstruktur, se
[ADMIN.md](ADMIN.md).

**Status idag:** inga riktiga hemligheter (API-nycklar, access keys) finns
ännu i projektet. De två Cognito-ID:na nedan är inte hemliga i sig (de skyddas
av Cognitos egen inloggningslogik), men de behövs för att inloggningen ska
fungera. När ett backend-API kopplas på (t.ex. API Gateway/Lambda) fylls det
i under [avsnitt 4](#4-framtida-api-nycklar).

## 1. Nycklarna du ska fylla i lokalt

Skapa en fil `.env` i projektets rot (samma mapp som `package.json`). Kopiera
gärna från `.env.example`:

```bash
VITE_COGNITO_USER_POOL_ID=eu-north-1_Ab12Cd34E
VITE_COGNITO_CLIENT_ID=1a2b3c4d5e6f7g8h9i0jklmnop
```

| Nyckel | Vad det är | Var du hittar den |
| --- | --- | --- |
| `VITE_COGNITO_USER_POOL_ID` | ID:t för er User Pool (användardatabasen för personalen). Format: `<region>_XXXXXXXXX`. | AWS Console → **Amazon Cognito** → **User pools** → klicka på er pool → ID:t visas högst upp under poolens namn ("User pool ID"). |
| `VITE_COGNITO_CLIENT_ID` | ID:t för app-klienten som frontend loggar in genom. | Samma pool → **App integration** (eller **App clients** i nya konsolen) → **App clients and analytics** → "Client ID". |
| `VITE_API_BASE_URL` *(valfritt, ännu inte i bruk)* | Bas-URL till ert backend-API. | Fylls i när API:t finns, se [avsnitt 4](#4-framtida-api-nycklar). |

Viktigt om `.env`:

- `.env` är redan git-ignorerad i det här projektet — committa den aldrig.
- Vite läser bara variabler som börjar med `VITE_`.
- Vite bakar in värdena vid **byggtillfället**. Starta om `npm run dev` efter
  att du ändrat `.env`, och bygg om (`npm run build`) inför deploy.
- `VITE_COGNITO_*` är inga hemligheter i sig, men lägg **aldrig**
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` eller andra riktiga hemligheter
  i frontend — de blir synliga för alla som öppnar sidan (allt i en
  Vite-bundel är publikt).

## 2. Cognito — krav på app-klienten

Frontend är en SPA (körs helt i webbläsaren), så app-klienten måste vara
konfigurerad så här. Kontrollera under din pool → **App clients** → din
klient:

1. **Ingen client secret.** Klienten måste vara skapad utan "Generate client
   secret" (typ "Public client"/"Single-page application"). En klient med
   secret kan inte användas från en webbläsare — har er klient en secret,
   skapa en ny app-klient utan.
2. **Auth flow: `ALLOW_USER_SRP_AUTH`** ska vara aktiverad (standard). Koden
   använder SRP, vilket betyder att lösenordet aldrig skickas i klartext.
   `ALLOW_REFRESH_TOKEN_AUTH` ska också vara på (standard) så att sessionen
   kan förnyas.
3. Ingen Hosted UI, ingen callback-URL och inga OAuth-scopes behövs — vi
   använder Cognitos API direkt, inte Hosted UI.

### Lösenordspolicy

Sidan "Välj ett nytt lösenord" (`src/features/auth/NewPasswordPage.tsx`)
visar en checklista med kraven: **minst 8 tecken, minst en stor bokstav,
minst en siffra**.

Cognitos *standardpolicy* kräver dessutom liten bokstav och specialtecken. Se
till att policyn i AWS matchar checklistan (annars kan Cognito neka ett
lösenord som ser godkänt ut i gränssnittet):

- Pool → **Authentication** → **Sign-in** / **Password policy** → Edit.
- Sätt: minst 8 tecken, kräv versaler, kräv siffror. Slå av "special
  characters" och "lowercase" **eller** lägg till motsvarande rader i
  `RULES` i `src/features/auth/NewPasswordPage.tsx` så att checklistan och
  policyn alltid säger samma sak.

### Så bjuder du in personal

1. AWS Console → din User Pool → **Users** → **Create user**.
2. Ange personens **e-postadress** som användarnamn, bocka i "Send an email
   invitation" och låt Cognito **generera ett tillfälligt lösenord**.
3. Personen får ett mejl med det tillfälliga lösenordet, går till
   `/logga-in` och loggar in med e-post + tillfälligt lösenord.
4. Cognito svarar med utmaningen `NEW_PASSWORD_REQUIRED` → appen skickar
   automatiskt personen till `/nytt-losenord`.
5. Personen väljer ett nytt lösenord som uppfyller kraven → kontot aktiveras
   och personen loggas in i admin-panelen.

Tips: det tillfälliga lösenordet har en giltighetstid (standard 7 dagar).
Går den ut visar appen ett felmeddelande — skicka då en ny inbjudan
(Users → välj användaren → "Reset password"/skapa om användaren).

Sessionen (JWT-tokens) sparas av Cognito-biblioteket i webbläsarens
localStorage och förnyas automatiskt, så personalen förblir inloggad tills de
loggar ut eller refresh-tokenen går ut (standard 30 dagar).

## 3. Anropa ert API med inloggningen

När ni kopplar frontend mot ert backend-API (API Gateway/Lambda) skickar ni
med ID-token som bevis på vem som är inloggad:

```ts
import { useAuth } from '../features/auth/useAuth'

const { getToken } = useAuth()
const token = await getToken() // null om utloggad

const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/bookings`, {
  headers: { Authorization: `Bearer ${token}` },
})
```

På AWS-sidan: ge ert API en **Cognito authorizer** (API Gateway → Authorizers
→ Cognito → peka på samma User Pool) så validerar API Gateway tokenen åt er
automatiskt. Glöm inte CORS på API:t så att er frontend-domän får anropa det.

## 4. Framtida API-nycklar

Inga riktiga API-nycklar finns i projektet än. När ett backend-API (t.ex.
API Gateway/Lambda) eller tredjepartstjänster (betalning, e-post, SMS m.m.)
kopplas på, dokumentera dem här enligt samma mall som Cognito-nycklarna ovan:

| Nyckel | Vad det är | Var du hittar den | Status |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Bas-URL till backend-API:t. | — | Ej i bruk än |

Kom ihåg samma regel som ovan: allt som börjar med `VITE_` hamnar synligt i
den publika bundeln. Riktiga hemligheter (databaslösenord, tredjeparts-API-
nycklar med skrivrättigheter, AWS-nycklar) hör hemma på **backend-sidan**,
aldrig i den här frontend-koden eller i `.env`.

## 5. CI/CD-konfiguration (ej hemligt)

Det här repot deployas via GitHub Actions (`.github/workflows/`) till
S3 + CloudFront, med separata AWS-konton för dev och prod. Icke-hemlig
deploy-konfiguration ligger i `.github/config/project.env`:

```bash
AWS_REGION=eu-north-1
OIDC_ROLE_ARN_DEV=...   # IAM-roll CI antar för att deploya till dev
S3_BUCKET_DEV=...
CLOUDFRONT_DISTRIBUTION_ID_DEV=...
OIDC_ROLE_ARN_PROD=...
S3_BUCKET_PROD=...
CLOUDFRONT_DISTRIBUTION_ID_PROD=...
```

Dessa är inte hemligheter (bucket-namn, roll-ARN:er och distributions-ID:n
avslöjar inget känsligt i sig), så det är okej att de är committade. CI
autentiserar till AWS via GitHub OIDC — inga långlivade AWS-nycklar lagras
i GitHub.

**Cognito-värden för deployade miljöer** fylls i separat, som fyra
`REPLACE_ME`-rader i samma fil:

```bash
VITE_COGNITO_USER_POOL_ID_DEV=...   # poolen i dev-kontot (877653167825)
VITE_COGNITO_CLIENT_ID_DEV=...
VITE_COGNITO_USER_POOL_ID_PROD=...  # poolen i prod-kontot (343695380960)
VITE_COGNITO_CLIENT_ID_PROD=...
```

> **Obs:** i skrivande stund plockar inte `reusable_cicd.yml` faktiskt upp
> dessa fyra rader ännu — bygg-steget behöver kopplas ihop med dem innan
> deployad dev/prod kan logga in mot Cognito. Lokal utveckling (`.env`)
> fungerar redan idag oavsett detta.

Precis som `VITE_COGNITO_*` lokalt är inte dessa fyra hemligheter (de syns
ändå i den publika JS-bundeln), så det är okej att de är committade — samma
mönster som bucket- och distributions-ID:na. Saknas värdena byggs och
deployas appen ändå, men med en varning i workflow-loggen, och inloggningen
visar då "Cognito är inte konfigurerat".

**SPA-fallback i CloudFront:** Appen använder riktiga URL:er (`/logga-in`
m.fl.), så båda CloudFront-distributionerna behöver en custom error
response: **403 → `/index.html` (HTTP 200)** och gärna **404 → `/index.html`
(200)** också (CloudFront → din distribution → Error pages). Utan detta ger
en omladdning på `/logga-in` ett fel.

## 6. Vanliga fel

| Symptom | Orsak / åtgärd |
| --- | --- |
| "Cognito är inte konfigurerat" | `.env` saknas eller är tom, eller dev-servern startades inte om efter ändring. |
| `User pool client ... does not exist` | Fel `VITE_COGNITO_CLIENT_ID`, eller klienten hör till en annan pool/region. |
| `Unable to verify secret hash for client` | App-klienten har en client secret — skapa en klient utan secret (avsnitt 2). |
| "Fel e-post eller lösenord" direkt vid första inloggningen | Kontrollera att användaren skapades med e-posten som användarnamn och att det tillfälliga lösenordet kopierades exakt (inga mellanslag). |
| Cognito nekar det nya lösenordet trots grön checklista | Poolens password policy kräver mer än checklistan (t.ex. specialtecken) — synka policyn och `RULES` (avsnitt 2). |
| Sidan blir 404/403 vid omladdning på `/logga-in` i dev/prod | SPA-fallback saknas i CloudFront (avsnitt 5). |
| Inloggningen fungerar lokalt men inte i deployad miljö | `VITE_COGNITO_*`-raderna i `.github/config/project.env` är inte ifyllda/kopplade för den miljön (avsnitt 5). |
