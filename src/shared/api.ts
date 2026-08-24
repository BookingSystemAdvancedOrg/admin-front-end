import { getIdToken } from '../features/auth/cognito'

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
 * Anropar backend med inloggningens ID-token i Authorization-headern.
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
  const token = await getIdToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    throw new Error(`API-fel ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as T
}
