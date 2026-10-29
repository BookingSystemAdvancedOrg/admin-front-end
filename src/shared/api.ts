import { getAccessToken } from '../features/auth/cognito'
import { busyEnd, busyStart } from './motion/busy'

/**
 * Bas-URL till backend-API:t. VITE_API_BASE_URL sätts i .env lokalt och i
 * .github/config/project.env för deploy - se docs/BACKEND-KOPPLING.md.
 * Så länge den inte är satt kör alla sidor på mockdata i respektive
 * features-mapps data.ts.
 *
 * I det deployade bygget går API:t alltid via /api på appens egen adress
 * (CloudFront skickar vidare till API Gateway). Samma origin är det som gör
 * att inloggningens refresh-token kan ligga i en HttpOnly-cookie, och appen
 * behöver ingen CORS. I `npm run dev` gör vite.config.ts samma sak med sin
 * proxy.
 */
const CONFIGURED_API = import.meta.env.VITE_API_BASE_URL as string | undefined

export const API_BASE_URL: string | undefined = CONFIGURED_API
  ? import.meta.env.PROD
    ? '/api'
    : CONFIGURED_API
  : undefined

export function isApiConfigured(): boolean {
  return Boolean(API_BASE_URL)
}

/**
 * Ett API-fel med statuskoden bevarad, så anropare kan skilja t.ex. 404
 * (finns inte) från 409 (redan finns) istället för att bara läsa text.
 * `message` är API:ts { error: string }-fält när det finns, annars råtext;
 * `code` är API:ts stabila kod (`code`, annars `error` när det är en kod,
 * annars en kod för statusen) och `field` fältet ett valideringsfel gäller.
 * `fromServer` skiljer API:ts råa svar från fel som features redan har
 * översatt till svenska (new ApiError(409, 'Bordet är upptaget.')).
 * Visa aldrig `message` från servern direkt: använd errorText (errors.ts).
 */
export class ApiError extends Error {
  status: number
  code: string
  field?: string
  fromServer: boolean

  constructor(
    status: number,
    message: string,
    opts: { code?: string; field?: string; fromServer?: boolean } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = opts.code ?? (CODE.test(message) ? message : statusCode(status))
    this.field = opts.field
    this.fromServer = opts.fromServer ?? false
  }
}

/** Ingen kontakt med API:t (offline, DNS, CORS, avbruten anslutning). */
export class NetworkError extends ApiError {
  constructor() {
    super(0, 'Ingen kontakt med servern. Kontrollera internetanslutningen och försök igen.', { code: 'network' })
    this.name = 'NetworkError'
  }
}

const CODE = /^[a-z][a-z0-9_]*$/

function statusCode(status: number): string {
  if (status === 0) return 'network'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 413) return 'too_large'
  if (status === 429) return 'too_many_requests'
  if (status >= 500) return 'internal_error'
  return 'invalid_request'
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; code?: string; field?: string }
    const message = body.error ?? body.message ?? text
    const code = typeof body.code === 'string' && CODE.test(body.code) ? body.code
      : typeof body.error === 'string' && CODE.test(body.error) ? body.error
        : statusCode(res.status)
    return new ApiError(res.status, message, { code, field: body.field, fromServer: true })
  } catch {
    // CloudFront/API Gateway kan svara med HTML eller tom text (502/504).
    return new ApiError(res.status, text || res.statusText, { code: statusCode(res.status), fromServer: true })
  }
}

/**
 * Omförsök, så att ett tillfälligt "upptaget" inte blir ett fel för gästen:
 * - 429 utan lång Retry-After = API Gatewayns tak - anropet kördes aldrig,
 *   så alla metoder får försöka igen. Vår egen spärr per gäst (429 med
 *   lång Retry-After) försöks inte om.
 * - Läsningar (GET) försöker också igen vid 502/503/504 och tappad
 *   anslutning. Skrivanrop gör det inte - de kan redan ha gått igenom.
 */
export const RETRY_DELAYS_MS: readonly number[] = import.meta.env.MODE === 'test' ? [0, 0] : [400, 1200]
const MAX_RETRY_AFTER_MS = 3_000

function retryAfterMs(res: Response): number {
  const raw = res.headers?.get?.('Retry-After')
  if (raw == null || raw === '') return 0
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds * 1000 : Number.POSITIVE_INFINITY
}

function worthRetrying(method: string, res: Response): boolean {
  if (res.status === 429) return retryAfterMs(res) <= MAX_RETRY_AFTER_MS
  return method === 'GET' && (res.status === 502 || res.status === 503 || res.status === 504)
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchWithRetry(method: string, send: () => Promise<Response>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= RETRY_DELAYS_MS.length
    let res: Response
    try {
      res = await send()
    } catch (err) {
      // Bara en tappad anslutning (TypeError) på en läsning - inte timeout.
      if (last || method !== 'GET' || !(err instanceof TypeError)) throw err
      await wait(RETRY_DELAYS_MS[attempt])
      continue
    }
    if (last || res.ok || !worthRetrying(method, res)) return res
    await wait(Math.max(RETRY_DELAYS_MS[attempt], retryAfterMs(res)))
  }
}

/**
 * Anropar backend med inloggningens access-token i Authorization-headern
 * (API:ts JWT-authorizer validerar access-tokens, inte ID-tokens - se
 * backend-spec:ens 401-beskrivning).
 * Används när sidorna kopplas från mockdata till riktigt API, t.ex.:
 *
 *   const users = await apiFetch<{ items: User[] }>('/list-users')
 *   await apiFetch(`/locations/${id}/menu/items`, {
 *     method: 'POST',
 *     body: JSON.stringify(dish),
 *   })
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error(
      'VITE_API_BASE_URL är inte satt - appen kör på mockdata. Se docs/BACKEND-KOPPLING.md.',
    )
  }
  const token = await getAccessToken()
  const method = (options.method ?? 'GET').toUpperCase()
  // Skrivningar syns som en strimma överst (shared/motion/BusyBar) tills de är klara.
  const writing = method !== 'GET'
  if (writing) busyStart()
  let res: Response
  try {
    res = await fetchWithRetry(method, () => fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    }))
  } catch (err) {
    // fetch() avvisar bara när svaret aldrig kom (offline, tappad anslutning).
    if (err instanceof TypeError) throw new NetworkError()
    throw err
  } finally {
    if (writing) busyEnd()
  }
  if (!res.ok) {
    throw await toApiError(res)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
