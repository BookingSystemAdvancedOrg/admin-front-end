const STORAGE_KEY = 'admin-mock-session'

/**
 * Dev-inloggningens uppgifter. Vite ersätter `import.meta.env.DEV` med
 * `false` i produktionsbygget, så båda blir tomma strängar och själva
 * texterna försvinner ur den publika JS-bundeln.
 *
 * Det spelar roll: mock-inloggningen är visserligen avstängd i produktion
 * ändå, men en bundel som skyltar med "test@test.se / test1234" ger vem som
 * helst ett färdigt par att prova mot det RIKTIGA /auth/login — skulle
 * kontot någon gång ha skapats på riktigt i Cognito vore det en direkt väg in.
 */
export const MOCK_EMAIL = import.meta.env.DEV ? 'test@test.se' : ''
export const MOCK_PASSWORD = import.meta.env.DEV ? 'test1234' : ''

/** Mock-inloggning finns bara i Vite-dev, aldrig i `npm run build`. */
export function isMockAuthEnabled(): boolean {
  return import.meta.env.DEV
}

export function tryMockSignIn(email: string, password: string): boolean {
  // Tomma konstanter (produktionsbygget) får aldrig matcha tomma fält.
  if (!isMockAuthEnabled() || !MOCK_EMAIL || !MOCK_PASSWORD) return false
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
