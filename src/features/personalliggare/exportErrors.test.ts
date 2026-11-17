import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { errorText } from '../../shared/errors'
import { ERRORS } from './api'

describe('personalliggare export errors', () => {
  it('asks for a shorter period when the export is too large', () => {
    const err = new ApiError(413, 'export_too_large', { code: 'export_too_large', fromServer: true })
    expect(errorText(err, 'Kunde inte exportera.', ERRORS)).toBe(
      'Exporten blir för stor. Välj en kortare period, till exempel en månad.',
    )
  })
})
