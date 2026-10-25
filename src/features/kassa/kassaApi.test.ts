import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { errorText, kr, localTotals } from './kassaApi'

describe('kassaApi', () => {
  it('formats öre the way the receipt does', () => {
    expect(kr(38750)).toBe('387,50')
    expect(kr(123456789)).toBe('1 234 567,89')
    expect(kr(-1490)).toBe('-14,90')
  })

  it('totals a bill like the server, discount included', () => {
    const lines = [{ unitPrice: 14900, quantity: 1 }, { unitPrice: 9500, quantity: 1 }]
    expect(localTotals(lines, null)).toEqual({ gross: 24400, discount: 0, total: 24400 })
    expect(localTotals(lines, { kind: 'percent', value: 10, label: 'Personal' })).toEqual({ gross: 24400, discount: 2440, total: 21960 })
    expect(localTotals(lines, { kind: 'amount', value: 99999, label: 'x' }).total).toBe(0)
  })

  it('explains a control system outage in Swedish', () => {
    expect(errorText(new ApiError(503, 'control_system_unreachable'))).toMatch(/Kontrollsystemet svarar inte/)
    expect(errorText(new ApiError(409, 'copy_exists'))).toMatch(/bara finnas en/)
  })
})
