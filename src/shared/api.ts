import { getAccessToken } from '../features/auth/cognito'

/**
 * Bas-URL till backend-API:t (API Gateway). Sätts i .env lokalt och i
 * .github/config/project.env för deploy — se docs/BACKEND-KOPPLING.md.
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
 * Anropar backend med inloggningens access-token i Authorization-headern
 * (API:ts JWT-authorizer validerar access-tokens, inte ID-tokens — se
 * backend-spec:ens 401-beskrivning).
 * Används när sidorna kopplas från mockdata till riktigt API, t.ex.:
 *
 *   const bokningar = await apiFetch<Reservation[]>('/reservations')
 *   await apiFetch('/menu', { method: 'POST', body: JSON.stringify(dish) })
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error(
      'VITE_API_BASE_URL är inte satt — appen kör på mockdata. Se docs/BACKEND-KOPPLING.md.',
    )
  }
  const token = await getAccessToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    throw await toApiError(res)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}
