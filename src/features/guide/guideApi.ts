import { apiFetch, isApiConfigured } from '../../shared/api'

/**
 * Om användaren har gått igenom guiden sparas på KONTOT
 * (GET/PUT /users/me/guide), så att den visas en enda gång per person -
 * inte en gång per dator eller webbläsare. Webbläsaren minns det också, så
 * att ingen fråga behövs vid varje inloggning.
 */

const STORAGE_PREFIX = 'booqy-guide-done:'

export function seenLocally(user: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${user}`) === '1'
  } catch {
    return false
  }
}

export function rememberLocally(user: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${user}`, '1')
  } catch {
    // Ingen lagring (privat läge) - kontot minns ändå.
  }
}

/**
 * true/false från kontot. null = går inte att avgöra just nu (nätverksfel) -
 * då visas guiden inte, hellre det än att den kommer tillbaka för någon som
 * redan sett den. Utan API (lokal utveckling) gäller bara webbläsaren.
 */
export async function guideDoneOnAccount(): Promise<boolean | null> {
  if (!isApiConfigured()) return false
  try {
    const res = await apiFetch<{ completed?: boolean }>('/users/me/guide')
    return res.completed === true
  } catch {
    return null
  }
}

export async function markGuideDoneOnAccount(): Promise<void> {
  if (!isApiConfigured()) return
  try {
    await apiFetch('/users/me/guide', { method: 'PUT' })
  } catch {
    // Webbläsaren minns det ändå; nästa avslut försöker igen.
  }
}
