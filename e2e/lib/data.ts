/** Every record a test creates starts with E2E, so it can be found and removed. */
export const RUN = process.env.E2E_RUN ?? new Date().toISOString().slice(5, 16).replace(/\D/g, '')
export const TENANT_NAME = 'E2E Testkrogen Åäö'
export const TENANT_SLUG = process.env.E2E_TENANT_SLUG ?? 'e2e-testkrogen'
/** SES mailbox simulator: accepted in the dev SES sandbox, reaches no person. */
export const mail = (tag: string) => `success+e2e-${tag}@simulator.amazonses.com`
/** PTS range reserved for fiction (070-1740605..699): never a real subscriber. */
export const PHONE = '+46 70 174 06 05'
/** Short random tag, so repeated runs (and projects) never reuse a record. */
export const uniq = () => Math.random().toString(36).slice(2, 7)
/**
 * A random number in the fiction range, 070-174 06 05..99, as a guest types
 * it. The API allows 5 online bookings per phone per 24 h, so a booking spec
 * must not reuse one number.
 */
export function fictionPhone(): string {
  const n = 5 + Math.floor(Math.random() * 95)
  return `070-174 06 ${String(n).padStart(2, '0')}`
}
/** Luhn-valid made-up org number. */
export const ORG_NUMBER = '5590000005'
