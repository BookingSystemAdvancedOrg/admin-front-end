/**
 * MOCKDATA för de delar av Inställningar som ännu saknar API: betalningar
 * (Stripe-status) och avbokningspolicyn. Ersätts med backend-anrop när de
 * endpointsen finns — se docs/BACKEND-KOPPLING.md.
 *
 * Personal & behörigheter innehåller INGEN mockdata: listan hämtas från
 * GET /list-users och alla åtgärder går mot /users/*-API:t (usersApi.ts).
 * Restaurangprofilen nedan är startvärden för "skapa plats"-formuläret,
 * som skrivs över av GET /locations/{id} så snart en plats finns.
 */

import type { BusinessHours } from './locationApi'

/**
 * Restaurangens grunduppgifter. Alla fyra fält kommer från Location-API:t
 * (GET /locations/{id}, fälten email/phoneNumber) och skickas tillbaka vid
 * sparning. Äldre platser som skapades innan kontaktfälten fanns kan sakna
 * telefon/e-post tills de fylls i och sparas första gången.
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

/**
 * Tomt formulär för en plats som ännu inte finns. Fälten fylls antingen av
 * GET /locations/{id} eller av den som skapar platsen.
 *
 * De var tidigare förifyllda med en påhittad restaurang, vilket var direkt
 * riskabelt: ett tryck på "Spara ändringar" utan att redigera hade skapat en
 * RIKTIG plats med den påhittade datan i databasen.
 */
export const EMPTY_PROFILE: RestaurantProfile = {
  name: '',
  phone: '',
  address: '',
  email: '',
}

/**
 * Neutrala startvärden — inte mockdata, utan rimliga utgångspunkter som ändå
 * måste bekräftas av användaren. Tidszonen är den enda svenska restauranger
 * rimligen har, och API:t kräver ett giltigt IANA-namn. Bokningslängden och
 * grace-perioden måste vara giltiga (> 0 respektive ≥ 0) för att formuläret
 * ska gå att skicka — noll hade bara gett ett valideringsfel direkt.
 */
export const DEFAULT_TIMEZONE = 'Europe/Stockholm'
export const DEFAULT_BOOKING_DURATION_HOURS = 2
export const DEFAULT_GRACE_PERIOD_HOURS = 0.25

/** Inga öppettider förifyllda — de sätts per restaurang. */
export const EMPTY_BUSINESS_HOURS: BusinessHours = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
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
