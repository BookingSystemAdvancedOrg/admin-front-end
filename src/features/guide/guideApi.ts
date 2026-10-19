import { apiFetch, isApiConfigured } from '../../shared/api'
import { GUIDE_KEY_PREFIX } from '../../shared/storageRegistry'

/**
 * Om användaren har gått igenom guiden sparas på KONTOT
 * (GET/PUT /users/me/guide), så att den visas en enda gång per person -
 * inte en gång per dator eller webbläsare. Webbläsaren minns det också, så
 * att ingen fråga behövs vid varje inloggning.
 */

// Nyckeln bär användarens id (sub), aldrig e-postadressen: localStorage
// ligger kvar efter utloggning, och en e-post där vore en personuppgift som
// blir kvar på en delad dator.
function keyFor(user: string): string | null {
  return user && !user.includes('@') ? `${GUIDE_KEY_PREFIX}${user}` : null
}

export function seenLocally(user: string): boolean {
  const key = keyFor(user)
  if (!key) return false
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function rememberLocally(user: string): void {
  const key = keyFor(user)
  if (!key) return
  try {
    localStorage.setItem(key, '1')
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
