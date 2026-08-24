const STORAGE_KEY = 'admin-mock-session'

export const MOCK_EMAIL = 'test@test.se'
export const MOCK_PASSWORD = 'test1234'

/** Mock-inloggning finns bara i Vite-dev, aldrig i `npm run build`. */
export function isMockAuthEnabled(): boolean {
  return import.meta.env.DEV
}

export function tryMockSignIn(email: string, password: string): boolean {
  if (!isMockAuthEnabled()) return false
  const match =
    email.trim().toLowerCase() === MOCK_EMAIL && password === MOCK_PASSWORD
  if (match) sessionStorage.setItem(STORAGE_KEY, MOCK_EMAIL)
  return match
}

export function getMockSessionEmail(): string | null {
  if (!isMockAuthEnabled()) return null
  return sessionStorage.getItem(STORAGE_KEY)
}

export function clearMockSession(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
