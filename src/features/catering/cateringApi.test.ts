import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { errorText } from './cateringApi'

describe('errorText for signing', () => {
  it('names a sign method the signing service has not switched on', () => {
    expect(errorText(new ApiError(409, 'signing_authentication_to_sign_method_disabled'))).toMatch(/BankID-signering är inte påslagen/)
  })

  it('explains any other refusal from the signing service', () => {
    expect(errorText(new ApiError(409, 'signing_document_state_error'))).toMatch(/Signeringstjänsten tog inte emot offerten/)
  })
})
