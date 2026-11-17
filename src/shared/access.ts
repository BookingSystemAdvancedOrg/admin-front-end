/**
 * Personalens behörigheter per område (application shared/staff_access.py).
 *
 * Varje sida i admin som restaurangen arbetar i är ett område. Ägaren väljer
 * vilka områden hela personalen får (gruppen) och kan sedan ge en person fler
 * eller ta bort gruppens för just den personen:
 *
 *   personens områden = (gruppens + egna) - borttagna
 *
 * Ägaren har alltid allt. Servern är facit: den svarar 403 `no_access` på
 * ett område man inte har, menyn och sidorna döljer bara det man ändå inte
 * får öppna.
 */

import type { FeatureKey } from './contracts'
import type { Tenant } from './tenant'

export type Area =
  | 'statistik'
  | 'bokningar'
  | 'bestallningar'
  | 'catering'
  | 'personalliggare'
  | 'telefon'
  | 'meny'
  | 'layout'
  | 'personal'
  | 'gaster'
  | 'presentkort'
  | 'evenemang'
  | 'marknadsforing'

export interface StaffAccessPerson {
  add: Area[]
  remove: Area[]
}

/** GET /tenant `staffAccess` (bara ägaren). */
export interface StaffAccessConfig {
  areas: Area[]
  defaults: Area[]
  users: Record<string, StaffAccessPerson>
  version: number
}

/** Det personalen kunde öppna innan behörigheterna fanns. */
export const LEGACY_STAFF_AREAS = [
  'statistik',
  'bokningar',
  'bestallningar',
  'catering',
  'personalliggare',
  'telefon',
  'meny',
  'layout',
  'gaster',
  'evenemang',
] as const

/** Områdena i menyns ordning, med sidans namn och planens funktion. */
export const AREAS: { area: Area; label: string; feature?: FeatureKey | FeatureKey[] }[] = [
  { area: 'statistik', label: 'Statistik' },
  { area: 'bokningar', label: 'Bokningar' },
  { area: 'bestallningar', label: 'Beställningar', feature: 'ordering' },
  { area: 'catering', label: 'Catering', feature: 'catering' },
  { area: 'personalliggare', label: 'Personalliggare', feature: 'personalliggare' },
  { area: 'telefon', label: 'Telefon', feature: 'phoneAgent' },
  { area: 'meny', label: 'Meny' },
  { area: 'layout', label: 'Layout' },
  { area: 'personal', label: 'Personal' },
  { area: 'gaster', label: 'Gäster', feature: 'guestCrm' },
  { area: 'presentkort', label: 'Presentkort', feature: 'giftCards' },
  { area: 'evenemang', label: 'Evenemang', feature: 'events' },
  { area: 'marknadsforing', label: 'Marknadsföring', feature: ['marketing', 'metaAds', 'googleBusiness', 'socialPosting'] },
]

export function areaLabel(area: Area): string {
  return AREAS.find((a) => a.area === area)?.label ?? area
}

/** Varifrån en persons bock kommer. */
export type TickSource = 'group' | 'own' | 'removed' | 'none'

export function personSource(config: Pick<StaffAccessConfig, 'defaults' | 'users'>, sub: string, area: Area): TickSource {
  const own = config.users[sub] ?? { add: [], remove: [] }
  const inGroup = config.defaults.includes(area)
  if (inGroup) return own.remove.includes(area) ? 'removed' : 'group'
  return own.add.includes(area) ? 'own' : 'none'
}

/** Personens områden: (gruppens + egna) - borttagna. */
export function personAreas(config: Pick<StaffAccessConfig, 'defaults' | 'users'>, sub: string): Area[] {
  return AREAS.map((a) => a.area).filter((area) => {
    const s = personSource(config, sub, area)
    return s === 'group' || s === 'own'
  })
}

/**
 * Bocka i eller ur ett område för en person. Ett område från gruppen som
 * bockas ur blir "borttaget för personen"; ett som inte är gruppens blir
 * "eget". Att bocka i igen tar bara bort personens ändring.
 */
export function togglePerson(
  config: Pick<StaffAccessConfig, 'defaults' | 'users'>,
  sub: string,
  area: Area,
  on: boolean,
): StaffAccessPerson {
  const own = config.users[sub] ?? { add: [], remove: [] }
  const inGroup = config.defaults.includes(area)
  let add = own.add.filter((a) => a !== area)
  let remove = own.remove.filter((a) => a !== area)
  if (inGroup && !on) remove = [...remove, area]
  if (!inGroup && on) add = [...add, area]
  const order = AREAS.map((a) => a.area)
  add = order.filter((a) => add.includes(a))
  remove = order.filter((a) => remove.includes(a))
  return { add, remove }
}

/**
 * Får den inloggade öppna området? Ägaren alltid. Personal: det servern
 * listar i `access.areas` (gruppens områden plus egna, minus borttagna). Ett
 * äldre API utan listan: som innan behörigheterna fanns.
 */
export function canOpen(
  tenant: Pick<Tenant, 'role' | 'insights' | 'access'> | null | undefined,
  area: Area,
): boolean {
  if (!tenant) return false
  if (tenant.role === 'owner_user') return true
  if (tenant.access) return tenant.access.areas.includes(area)
  if (area === 'statistik') return (tenant.insights?.staffAccess ?? 'operations') !== 'none'
  return (LEGACY_STAFF_AREAS as readonly Area[]).includes(area)
}
