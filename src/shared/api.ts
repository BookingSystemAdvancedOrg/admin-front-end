import { getAccessToken } from '../features/auth/cognito'

/**
 * Bas-URL till backend-API:t (API Gateway). Sätts i .env lokalt och i
 * .github/config/project.env för deploy - se docs/BACKEND-KOPPLING.md.
 * Så länge den inte är satt kör alla sidor på mockdata i respektive
 * features-mapps data.ts.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as
  | string
  | undefined

export function isApiConfigured(): boolean {
  return Boolean(API_BASE_URL)
}

/**
 * Ett API-fel med statuskoden bevarad, så anropare kan skilja t.ex. 404
 * (finns inte) från 409 (redan finns) istället för att bara läsa text.
 * `message` är API:ts { error: string }-fält när det finns, annars råtext.
 */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: string; message?: string }
    return new ApiError(res.status, body.error ?? body.message ?? text)
  } catch {
    return new ApiError(res.status, text || res.statusText)
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
  const res = await fetchWithRetry(method, () => fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  }))
  if (!res.ok) {
    throw await toApiError(res)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
