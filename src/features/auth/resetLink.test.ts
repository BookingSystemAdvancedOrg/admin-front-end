import { describe, expect, it } from 'vitest'
import { parseResetLink } from './resetLink'

describe('parseResetLink', () => {
  it('reads the code and the address from the fragment', () => {
    expect(parseResetLink('#code=123456&email=anna%40exempel.se')).toEqual({
      code: '123456',
      email: 'anna@exempel.se',
    })
  })

  it('keeps a plus in the address and ignores spaces in the code', () => {
    expect(parseResetLink('#code=123%20456&email=anna%2Bbar%40exempel.se')).toEqual({
      code: '123456',
      email: 'anna+bar@exempel.se',
    })
  })

  it('is null for a missing or broken link', () => {
    expect(parseResetLink('')).toBeNull()
    expect(parseResetLink('#code=123456')).toBeNull()
    expect(parseResetLink('#email=anna%40exempel.se')).toBeNull()
    expect(parseResetLink('#code=12345&email=anna%40exempel.se')).toBeNull()
    expect(parseResetLink('#code={####}&email=anna%40exempel.se')).toBeNull()
    expect(parseResetLink('#code=123456&email=anna')).toBeNull()
  })
})
