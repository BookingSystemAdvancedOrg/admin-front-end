import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { errorText, failureText, newCheckoutId, parseKronor } from './cardApi'
import type { CardPayment } from './cardApi'

describe('parseKronor', () => {
  it('turns kronor into öre', () => {
    expect(parseKronor('125')).toBe(12500)
    expect(parseKronor('125,5')).toBe(12550)
    expect(parseKronor('125,50')).toBe(12550)
    expect(parseKronor('125.05')).toBe(12505)
    expect(parseKronor('1 250 kr')).toBe(125000)
  })

  it('refuses what is not an amount', () => {
    for (const text of ['', 'abc', '12,345', '-5', '1e3', '12,']) expect(parseKronor(text)).toBeNull()
  })
})

describe('texts', () => {
  const payment = (extra: Partial<CardPayment>): CardPayment => ({
    paymentId: 'a'.repeat(32), locationId: 'l', date: '2026-10-24', amount: 500, readerId: 'tmr_1', status: 'failed', ...extra,
  })

  it('explains declines and reader problems in Swedish', () => {
    expect(failureText(payment({ failure: { code: 'insufficient_funds' } }))).toMatch(/otillräckligt saldo/)
    expect(failureText(payment({ failure: { code: 'reader_offline' } }))).toMatch(/offline/)
    expect(failureText(payment({ status: 'canceled' }))).toMatch(/Inget har dragits/)
    expect(failureText(payment({ failure: { code: 'something_new' } }))).toMatch(/gick inte igenom/)
  })

  it('maps API errors', () => {
    expect(errorText(new ApiError(409, 'terminal_not_enabled'))).toMatch(/inte aktiverade/)
    expect(errorText(new ApiError(409, 'order_already_paid'))).toMatch(/redan betalat/)
    expect(errorText(new ApiError(404, 'not found'))).toMatch(/finns inte/)
  })

  it('makes a 32 hex checkout id each time', () => {
    const a = newCheckoutId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(newCheckoutId()).not.toBe(a)
  })
})
