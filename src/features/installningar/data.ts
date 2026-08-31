/**
 * MOCKDATA — ersätts med backend-anrop när API:t är på plats:
 *   const settings = await apiFetch<RestaurantSettings>('/settings')
 * (se src/shared/api.ts och docs/BACKEND-KOPPLING.md)
 *
 * Personal & behörigheter är ett undantag: invite/redigera/ta bort/av-
 * aktivera/byt roll går redan mot det riktiga /users/*-API:t (se
 * usersApi.ts). Listan i InstallningarPage.tsx startar tom (inte mockad) —
 * det finns ingen GET/lista-endpoint än, så den fylls bara på med det som
 * bjuds in/ändras under den aktuella sidladdningen och återställs vid
 * omladdning tills en list-endpoint finns.
 */

import type { BusinessHours } from './locationApi'

/**
 * Namn/adress/telefon/e-post/öppettider är förifyllda startvärden för
 * "skapa plats"-formuläret — se InstallningarPage.tsx. Telefon och e-post
 * finns inte i Location-schemat (bara namn/adress/tidszon/öppettider/
 * bokningspolicy gör), så de fälten stannar lokala oavsett.
 */
export interface RestaurantProfile {
  name: string
  phone: string
  address: string
  email: string
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

export const MOCK_TIMEZONE = 'Europe/Stockholm'
export const MOCK_BOOKING_DURATION_HOURS = 2
export const MOCK_GRACE_PERIOD_HOURS = 0.25

export const MOCK_BUSINESS_HOURS: BusinessHours = {
  monday: [{ opensAt: '11:30', closesAt: '22:00' }],
  tuesday: [{ opensAt: '11:30', closesAt: '22:00' }],
  wednesday: [{ opensAt: '11:30', closesAt: '22:00' }],
  thursday: [{ opensAt: '11:30', closesAt: '22:00' }],
  friday: [{ opensAt: '11:30', closesAt: '23:30' }],
  saturday: [{ opensAt: '12:00', closesAt: '23:30' }],
  sunday: [{ opensAt: '12:00', closesAt: '21:00' }],
}

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
