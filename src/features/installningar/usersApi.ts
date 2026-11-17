import { BOOQY_FAULT, errorText as commonError } from '../../shared/errors'
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
  /** Tomt för ägare - bara personal (staff) hör till en plats. */
  locationId: string
  name: string
  email: string
  phone: string
  status: UserStatus
  createdBy: string
  createdAt: string
  /** Förhandsgodkänd länk till profilbilden (1 h), eller null. Frivillig. */
  avatarUrl?: string | null
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

/** Svensk titel per Cognito-grupp - enda källan, återanvänd i stället för att duplicera. */
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

/** Titeln för den inloggade användaren i sidebaren - den mest priviligierade av dess grupper. */
export function primaryGroupLabel(groups: string[]): string {
  const match = GROUP_PRIORITY.find((g) => groups.includes(g))
  return match ? GROUP_LABEL[match] : 'Personal'
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/

/** Klientspegling av Lambdans fältvalidering - samma regler, samma felmeddelanden. */
export function validateName(name: string): string | null {
  return name.trim() ? null : 'Skriv ett namn.'
}

export function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Skriv en e-postadress, till exempel namn@exempel.se.'
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
    return 'E-postadressen ser fel ut. Skriv den så här: namn@exempel.se.'
  }
  return null
}

export function validatePhone(phone: string): string | null {
  if (!phone.trim()) return 'Skriv ett telefonnummer, till exempel +46701234567.'
  if (!PHONE_PATTERN.test(phone)) {
    return 'Telefonnumret ser fel ut. Skriv det med +46 och utan mellanslag, till exempel +46701234567.'
  }
  return null
}

export function validateLocationId(
  group: CognitoGroup,
  locationId: string,
): string | null {
  if (group === 'staff_user' && !locationId.trim()) {
    return 'Välj vilken plats personalen ska jobba på.'
  }
  if (group !== 'staff_user' && locationId.trim()) {
    return 'En ägare hör till alla platser. Låt platsen vara tom.'
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
 * hanterar personal (role "staff"), och personal hanterar andra bara om
 * ägaren har gett dem området Personal.
 */
export function canManageTarget(
  caller: { sub: string | null; groups: string[]; personal?: boolean },
  target: User,
  action: UserAction,
): boolean {
  const isSelf = Boolean(caller.sub) && target.cognitoSub === caller.sub
  if (action !== 'profile' && isSelf) return false
  if (action === 'profile' && isSelf) return true
  if (target.role !== 'staff') return false
  if (caller.groups.includes('owner_user')) return true
  // Personal som ägaren gett Personal: redigera, inaktivera och aktivera
  // personalen på sin plats (servern listar bara dem). Roller och borttagning är ägarens.
  return Boolean(caller.personal) && (action === 'profile' || action === 'deactivate' || action === 'reactivate')
}

/** Mappar API:ts { error: string } + statuskod till svenska meddelanden. */
function toFriendlyUserError(err: unknown): Error {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err : new Error('Något gick fel hos Booqy. Försök igen om en stund.')
  }

  console.error(`[Users] ${err.status}: ${err.message}`)
  if (err.status === 0 || (err.status === 403 && err.code !== 'forbidden')) return new Error(commonError(err))

  const withField = (e: Error) => Object.assign(e, { field: err.field })
  switch (err.status) {
    case 400:
      if (err.message.includes('locationId is required')) {
        return withField(new Error('Välj vilken plats personalen ska jobba på.'))
      }
      if (err.message.includes('locationId must be empty')) {
        return withField(new Error('En ägare hör till alla platser. Låt platsen vara tom.'))
      }
      if (err.message.includes('email must be valid')) {
        return withField(new Error('E-postadressen ser fel ut. Skriv den så här: namn@exempel.se.'))
      }
      if (err.message.includes('phone must use E.164')) {
        return withField(new Error('Telefonnumret ser fel ut. Skriv det med +46 och utan mellanslag, till exempel +46701234567.'))
      }
      if (err.message.includes('at least one editable field')) {
        return withField(new Error('Du har inte ändrat något än. Ändra ett fält och spara.'))
      }
      return withField(new Error(commonError(err, 'Användaren sparades inte.', {}, { name: 'namnet', email: 'e-postadressen', phone: 'telefonnumret', role: 'rollen', locationId: 'platsen' })))
    case 401:
      return new Error('Du har loggats ut. Logga in igen och gör om det du höll på med.')
    case 403:
      return new Error('Ditt konto får inte göra det här. Be restaurangens ägare om hjälp.')
    case 404:
      return new Error('Användaren finns inte längre. Någon har nog redan tagit bort den.')
    case 409:
      if (err.message.includes('already exists')) {
        return new Error('Det finns redan en användare med den e-postadressen. Använd en annan e-postadress.')
      }
      return Object.assign(
        new Error('Någon annan ändrade användaren samtidigt. Nu visas det senaste. Spara igen om det behövs.'),
        { conflict: true },
      )
    case 429:
      return new Error('För många försök på kort tid. Vänta en minut och försök igen.')
    case 501:
      return new ApiError(501, `Den här delen är inte klar hos Booqy än. ${BOOQY_FAULT}`)
    case 503:
      return new ApiError(503, `Booqy svarar inte just nu. ${BOOQY_FAULT}`)
    default:
      return new Error(commonError(err, 'Något gick fel med användaren.'))
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
 * GET /list-users - "List visible internal users". Kontraktet: { items: [...] },
 * redan sorterad av backend (namn skiftlägesokänsligt, sen cognitoSub).
 * Ägaren ser restaurangens personal och sig själv - aldrig en annan
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
      // 404 här betyder att rutten saknas (inte att en användare saknas):
      // Booqys fel, med Rapportera till Booqy (shared/errors).
      throw new ApiError(404, 'route_not_found', { code: 'route_not_found' })
    }
    throw toFriendlyUserError(err)
  }
}

/**
 * GET /users/{cognitoSub}. Används inte av någon sida än - listan täcker
 * behovet - men hör till kontraktet och finns här för den som behöver läsa
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

/**
 * Bara de ändrade fälten skickas. Krockade sparningen med en ändring på annat
 * håll (409) skickas samma fält en gång till ovanpå det som nu är sparat.
 */
export async function updateUserProfile(
  cognitoSub: string,
  updates: UserProfileUpdate,
): Promise<User> {
  const send = () =>
    userCall(() =>
      apiFetch<User>(`/users/${encodeURIComponent(cognitoSub)}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
    )
  try {
    return await send()
  } catch (err) {
    if (!(err as { conflict?: boolean }).conflict) throw err
    return send()
  }
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
