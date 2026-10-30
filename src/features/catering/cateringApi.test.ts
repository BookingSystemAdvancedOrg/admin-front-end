import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { defaultValidUntil, errorText } from './cateringApi'
import type { CateringRequest } from './cateringApi'

describe('errorText for signing', () => {
  it('names a sign method the signing service has not switched on', () => {
    expect(errorText(new ApiError(409, 'signing_authentication_to_sign_method_disabled'))).toMatch(/BankID-signering är inte påslagen/)
  })

  it('explains any other refusal from the signing service', () => {
    expect(errorText(new ApiError(409, 'signing_document_state_error'))).toMatch(/Signeringstjänsten tog inte emot offerten/)
  })
})

describe('defaultValidUntil', () => {
  const today = new Date(2026, 9, 30)
  const req = (deliveryDate: string, offerValidDays?: number) =>
    ({ deliveryDate, settings: offerValidDays ? { offerValidDays } : {} }) as unknown as CateringRequest

  it('is today plus the validity days', () => {
    expect(defaultValidUntil(req('2026-12-01', 10), today)).toBe('2026-11-09')
  })

  it('never passes the delivery day', () => {
    expect(defaultValidUntil(req('2026-11-03'), today)).toBe('2026-11-03')
  })

  it('names the date field when it is after the delivery day', () => {
    const err = new ApiError(400, 'validUntil must not be after the delivery date', { field: 'validUntil', fromServer: true })
    expect(errorText(err)).toMatch(/efter leveransdagen/)
  })
})
