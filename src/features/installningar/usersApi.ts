import { apiFetch, ApiError } from '../../shared/api'

/**
 * Klient mot backendens /users/*-endpoints (manage-user-Lambdan). Speglar
 * medvetet exakt de valideringsregler och behörighetskontroller Lambdan
 * själv gör (se functions/manage-user/app.py i backend-repot, dev-grenen)
 * så att gränssnittet aldrig visar en åtgärd som ändå skulle nekas av
 * servern, och så att klientfel fångas innan ett onödigt API-anrop görs.
 */

export type CognitoGroup = 'staff_user' | 'owner_user' | 'super_user'
export type UserRole = 'staff' | 'owner_user' | 'super_admin'
export type UserStatus = 'active' | 'disabled'

export interface User {
  cognitoSub: string
  role: UserRole
  /** Tomt för owner_user/super_admin — bara personal (staff) hör till en plats. */
  locationId: string
  name: string
  email: string
  phone: string
  status: UserStatus
  createdBy: string
  createdAt: string
}

export interface UserInviteRequest {
  name: string
  email: string
  phone: string
  group: CognitoGroup
  locationId: string
}

export interface UserProfileUpdate {
  name?: string
  email?: string
  phone?: string
  locationId?: string
}

export interface UserGroupChangeRequest {
  group: CognitoGroup
  locationId: string
}

/** Cognito-grupp <-> User-tabellens role-fält (backendens _GROUP_TO_ROLE). */
export const GROUP_TO_ROLE: Record<CognitoGroup, UserRole> = {
  staff_user: 'staff',
  owner_user: 'owner_user',
  super_user: 'super_admin',
}
export const ROLE_TO_GROUP: Record<UserRole, CognitoGroup> = {
  staff: 'staff_user',
  owner_user: 'owner_user',
  super_admin: 'super_user',
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

/** Klientspegling av Lambdans fältvalidering — samma regler, samma felmeddelanden. */
export function validateName(name: string): string | null {
  return name.trim() ? null : 'Namn krävs.'
}

export function validateEmail(email: string): string | null {
  if (!email.trim()) return 'E-post krävs.'
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    return 'E-postadressen ser inte korrekt ut.'
  }
  return null
}

export function validatePhone(phone: string): string | null {
  if (!phone.trim()) return 'Telefonnummer krävs.'
  if (!PHONE_PATTERN.test(phone)) {
    return 'Telefonnummer måste vara i E.164-format, t.ex. +46701234567.'
  }
  return null
}

export function validateLocationId(
  group: CognitoGroup,
  locationId: string,
): string | null {
  if (group === 'staff_user' && !locationId.trim()) {
    return 'Plats-ID krävs för personal.'
  }
  if (group !== 'staff_user' && locationId.trim()) {
    return 'Plats-ID måste vara tomt för ägare/systemadmin.'
  }
  return null
}

/** Kan caller bjuda in någon till den här gruppen? Speglar _authorize_invite. */
export function canInvite(callerGroups: string[], group: CognitoGroup): boolean {
  if (group === 'staff_user') return true
  return callerGroups.includes('super_user')
}

export type UserAction = 'profile' | 'deactivate' | 'reactivate' | 'delete' | 'group'

/**
 * Kan caller utföra åtgärden mot den här användaren? Speglar _authorize_target:
 * ingen får agera på sig själv (utom att redigera sin egen profil), super_user
 * får hantera vem som helst, owner_user bara personal (role "staff").
 */
export function canManageTarget(
  caller: { sub: string | null; groups: string[] },
  target: User,
  action: UserAction,
): boolean {
  const isSelf = Boolean(caller.sub) && target.cognitoSub === caller.sub
  if (action !== 'profile' && isSelf) return false
  if (caller.groups.includes('super_user')) return true
  if (action === 'profile' && isSelf) return true
  return target.role === 'staff'
}

/** Mappar API:ts { error: string } + statuskod till svenska meddelanden. */
function toFriendlyUserError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Ett okänt fel inträffade.')
  }

  console.error(`[Users] ${err.status}: ${err.message}`)

  switch (err.status) {
    case 400:
      if (err.message.includes('locationId is required')) {
        return new Error('Plats-ID krävs för personal.')
      }
      if (err.message.includes('locationId must be empty')) {
        return new Error('Plats-ID måste vara tomt för ägare/systemadmin.')
      }
      if (err.message.includes('email must be valid')) {
        return new Error('E-postadressen ser inte korrekt ut.')
      }
      if (err.message.includes('phone must use E.164')) {
        return new Error('Telefonnummer måste vara i E.164-format.')
      }
      if (err.message.includes('at least one editable field')) {
        return new Error('Inget ändrades.')
      }
      return new Error(err.message)
    case 401:
      return new Error('Du är inte inloggad längre. Logga in igen.')
    case 403:
      return new Error('Du har inte behörighet att göra detta.')
    case 404:
      return new Error('Användaren hittades inte — kan redan vara borttagen.')
    case 409:
      if (err.message.includes('already exists')) {
        return new Error('Det finns redan en användare med den e-postadressen.')
      }
      return new Error(
        'Användaren ändrades samtidigt av någon annan. Ladda om och försök igen.',
      )
    case 429:
      return new Error('För många förfrågningar. Vänta en stund och försök igen.')
    case 501:
      return new Error(
        'Den här funktionen är inte klar på serversidan än (manage-user är inte deployad).',
      )
    case 503:
      return new Error('Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.')
    default:
      return new Error(err.message || `Serverfel (${err.status}).`)
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toFriendlyUserError(err)
  }
}

/**
 * GET /users — "List visible internal users". Kontraktet: { items: [...] },
 * redan sorterad av backend (namn skiftlägesokänsligt, sen cognitoSub).
 * Vilka som syns avgörs av callerns roll: super_user ser alla, owner ser
 * sin personal + sig själv.
 */
export async function listUsers(): Promise<User[]> {
  try {
    const res = await apiFetch<{ items?: User[] }>('/users')
    return res.items ?? []
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // 404 här betyder att rutten saknas (inte att en användare saknas).
      throw new Error(
        'Listan kan inte hämtas — GET /users är inte deployad på API:t än.',
      )
    }
    throw toFriendlyUserError(err)
  }
}

export function getUser(cognitoSub: string): Promise<User> {
  return call(() => apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}`))
}

export function inviteUser(input: UserInviteRequest): Promise<User> {
  return call(() =>
    apiFetch<User>('/users/invite', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
}

export function updateUserProfile(
  cognitoSub: string,
  updates: UserProfileUpdate,
): Promise<User> {
  return call(() =>
    apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  )
}

export function changeUserGroup(
  cognitoSub: string,
  input: UserGroupChangeRequest,
): Promise<User> {
  return call(() =>
    apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}/group`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  )
}

export function deactivateUser(cognitoSub: string): Promise<User> {
  return call(() =>
    apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}/deactivate`, {
      method: 'POST',
    }),
  )
}

export function reactivateUser(cognitoSub: string): Promise<User> {
  return call(() =>
    apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}/reactivate`, {
      method: 'POST',
    }),
  )
}

export function deleteUser(cognitoSub: string): Promise<void> {
  return call(() =>
    apiFetch<void>(`/users/${encodeURIComponent(cognitoSub)}`, {
      method: 'DELETE',
    }),
  )
}
