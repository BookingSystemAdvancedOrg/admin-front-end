import { apiFetch, ApiError } from '../../shared/api'

/**
 * Klient mot backendens /users/*-endpoints (manage-user-Lambdan). Speglar
 * medvetet exakt de valideringsregler och behörighetskontroller Lambdan
 * själv gör (se functions/manage-user/app.py i backend-repot, dev-grenen)
 * så att gränssnittet aldrig visar en åtgärd som ändå skulle nekas av
 * servern, och så att klientfel fångas innan ett onödigt API-anrop görs.
 */

/**
 * Restaurangens två roller. (super_user/systemadmin finns inte längre:
 * plattformens operatörer arbetar i operatörskonsolen, Booqy Console, och har
 * ingen inloggning i restaurangernas app.)
 */
export type CognitoGroup = 'staff_user' | 'owner_user'
export type UserRole = 'staff' | 'owner_user'
export type UserStatus = 'active' | 'disabled'

export interface User {
  cognitoSub: string
  role: UserRole
  /** Tomt för ägare — bara personal (staff) hör till en plats. */
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
}
export const ROLE_TO_GROUP: Record<UserRole, CognitoGroup> = {
  staff: 'staff_user',
  owner_user: 'owner_user',
}

/** Svensk titel per Cognito-grupp — enda källan, återanvänd i stället för att duplicera. */
export const GROUP_LABEL: Record<CognitoGroup, string> = {
  staff_user: 'Personal',
  owner_user: 'Ägare',
}

const GROUP_PRIORITY: CognitoGroup[] = ['owner_user', 'staff_user']

/**
 * Användarposter som skapats av operatörskonsolen (Booqy Console) bär gruppnamnet
 * som roll ("staff_user"); API:t skickar dem vidare som de är. Normaliseras
 * här så att resten av appen bara behöver känna till UserRole.
 */
export function normalizeUser(user: User): User {
  const role = user.role as string
  if (role === 'staff_user') return { ...user, role: 'staff' }
  return user
}

/** Titeln för den inloggade användaren i sidebaren — den mest priviligierade av dess grupper. */
export function primaryGroupLabel(groups: string[]): string {
  const match = GROUP_PRIORITY.find((g) => groups.includes(g))
  return match ? GROUP_LABEL[match] : 'Personal'
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
    return 'Ägare kopplas inte till en enskild plats.'
  }
  return null
}

/**
 * Kan caller bjuda in någon till den här gruppen? Speglar backendens
 * _authorize_invite: ägare bjuder in personal. Fler ägare läggs upp av
 * plattformen (operatörskonsolen), och personal får inte bjuda in någon.
 */
export function canInvite(callerGroups: string[], group: CognitoGroup): boolean {
  return callerGroups.includes('owner_user') && group === 'staff_user'
}

export type UserAction = 'profile' | 'deactivate' | 'reactivate' | 'delete' | 'group'

/**
 * Kan caller utföra åtgärden mot den här användaren? Speglar _authorize_target:
 * ingen får agera på sig själv (utom att redigera sin egen profil), ägare
 * hanterar personal (role "staff"), och personal hanterar inga andra
 * användare alls.
 */
export function canManageTarget(
  caller: { sub: string | null; groups: string[] },
  target: User,
  action: UserAction,
): boolean {
  const isSelf = Boolean(caller.sub) && target.cognitoSub === caller.sub
  if (action !== 'profile' && isSelf) return false
  if (action === 'profile' && isSelf) return true
  return caller.groups.includes('owner_user') && target.role === 'staff'
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
        return new Error('Ägare kopplas inte till en enskild plats.')
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

async function userCall(fn: () => Promise<User>): Promise<User> {
  return normalizeUser(await call(fn))
}

/**
 * GET /list-users — "List visible internal users". Kontraktet: { items: [...] },
 * redan sorterad av backend (namn skiftlägesokänsligt, sen cognitoSub).
 * Ägaren ser restaurangens personal och sig själv — aldrig en annan
 * restaurangs användare (servern listar per tenant).
 *
 * Sökvägen är medvetet inte /users: den hade krockat med /users/{cognitoSub},
 * som fångar allt under /users/ som ett cognitoSub.
 */
export async function listUsers(): Promise<User[]> {
  try {
    const res = await apiFetch<{ items?: User[] }>('/list-users')
    return (res.items ?? []).map(normalizeUser)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // 404 här betyder att rutten saknas (inte att en användare saknas).
      throw new Error(
        'Listan kan inte hämtas — GET /list-users är inte deployad på API:t än.',
      )
    }
    throw toFriendlyUserError(err)
  }
}

/**
 * GET /users/{cognitoSub}. Används inte av någon sida än — listan täcker
 * behovet — men hör till kontraktet och finns här för den som behöver läsa
 * om en enskild användare efter en samtidig ändring (409).
 */
export function getUser(cognitoSub: string): Promise<User> {
  return userCall(() => apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}`))
}

export function inviteUser(input: UserInviteRequest): Promise<User> {
  return userCall(() =>
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
  return userCall(() =>
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
  return userCall(() =>
    apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}/group`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  )
}

export function deactivateUser(cognitoSub: string): Promise<User> {
  return userCall(() =>
    apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}/deactivate`, {
      method: 'POST',
    }),
  )
}

export function reactivateUser(cognitoSub: string): Promise<User> {
  return userCall(() =>
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
