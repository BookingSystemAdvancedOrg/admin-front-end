/**
 * MOCKDATA — ersätts med backend-anrop när API:t är på plats:
 *   const settings = await apiFetch<RestaurantSettings>('/settings')
 *   const staff = await apiFetch<StaffMember[]>('/staff')
 * (se src/shared/api.ts och docs/BACKEND-KOPPLING.md)
 */

export interface RestaurantProfile {
  name: string
  phone: string
  address: string
  email: string
}

export interface OpeningHours {
  days: string
  hours: string
}

export interface StaffMember {
  id: string
  name: string
  role: 'Ägare' | 'Personal'
  email: string
  status: 'active' | 'invited'
}

export interface CancellationPolicy {
  lateFee: number
  noShowFee: number
  freeCancelHours: number
  autoCharge: boolean
}

export const MOCK_PROFILE: RestaurantProfile = {
  name: 'KÄLLA',
  phone: '08-123 45 67',
  address: 'Sveavägen 42, Stockholm',
  email: 'info@kallarestaurang.se',
}

export const MOCK_HOURS: OpeningHours[] = [
  { days: 'Mån - Tor', hours: '11:30 - 22:00' },
  { days: 'Fre', hours: '11:30 - 23:30' },
  { days: 'Lör', hours: '12:00 - 23:30' },
  { days: 'Sön', hours: '12:00 - 21:00' },
]

export const MOCK_STAFF: StaffMember[] = [
  {
    id: 's1',
    name: 'Anna Svensson',
    role: 'Ägare',
    email: 'anna@kallarestaurang.se',
    status: 'active',
  },
  {
    id: 's2',
    name: 'Erik Lindqvist',
    role: 'Personal',
    email: 'erik@kallarestaurang.se',
    status: 'active',
  },
  {
    id: 's3',
    name: 'Maria Holm',
    role: 'Personal',
    email: 'maria@kallarestaurang.se',
    status: 'invited',
  },
]

export const MOCK_POLICY: CancellationPolicy = {
  lateFee: 300,
  noShowFee: 450,
  freeCancelHours: 24,
  autoCharge: true,
}

/** Stripe-status visas bara — riktiga kontouppgifter bor i backend. */
export const MOCK_STRIPE = {
  connected: true,
  accountLabel: 'acct_1KällaAB · Utbetalning varje vecka',
}
