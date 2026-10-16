import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { kronor, moveErrorText } from './ordersApi'

describe('ordersApi', () => {
  it('formats öre as kronor', () => {
    expect(kronor(28550)).toBe('285,50 kr')
    expect(kronor(25000)).toBe('250 kr')
  })

  it('turns server errors into Swedish', () => {
    expect(moveErrorText(new ApiError(409, 'changed_retry'))).toMatch(/ändrats av någon annan/)
    expect(moveErrorText(new ApiError(409, 'cannot_move_completed_to_ready'))).toMatch(/kan inte flyttas/)
    expect(moveErrorText(new ApiError(404, 'not found'))).toMatch(/finns inte längre/)
    expect(moveErrorText(new Error('x'))).toMatch(/Kunde inte spara/)
  })
})
