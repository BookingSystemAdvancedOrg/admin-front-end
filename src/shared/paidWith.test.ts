import { describe, expect, it } from 'vitest'
import { methodLabel, orderPaidParts, paidWithLabel, refundFailedText } from './paidWith'

const kr = (ore: number) => `${ore / 100} kr`

describe('paidWithLabel', () => {
  it('writes a card as brand and last four, or Kort', () => {
    expect(paidWithLabel({ method: 'card', brand: 'visa', last4: '4242' })).toBe('Visa ****4242')
    expect(paidWithLabel({ method: 'card', brand: 'mastercard', last4: '4444' })).toBe('Mastercard ****4444')
    expect(paidWithLabel({ method: 'card', brand: 'amex', last4: '0005' })).toBe('American Express ****0005')
    expect(paidWithLabel({ method: 'card', brand: 'visa' })).toBe('Visa')
    expect(paidWithLabel({ method: 'card', brand: 'okänt', last4: '1111' })).toBe('Kort ****1111')
    expect(paidWithLabel({ method: 'card' })).toBe('Kort')
    expect(paidWithLabel({ method: 'card', last4: '12' })).toBe('Kort')
  })

  it('names wallets and other methods', () => {
    expect(paidWithLabel({ method: 'apple_pay', brand: 'visa', last4: '4242' })).toBe('Apple Pay')
    expect(paidWithLabel({ method: 'google_pay' })).toBe('Google Pay')
    expect(paidWithLabel({ method: 'swish' })).toBe('Swish')
    expect(paidWithLabel({ method: 'klarna' })).toBe('Klarna')
    expect(paidWithLabel({ method: 'paypal' })).toBe('PayPal')
    expect(paidWithLabel({ method: 'link' })).toBe('Link')
    expect(paidWithLabel({ method: 'amazon_pay' })).toBe('Amazon Pay')
    expect(paidWithLabel({ method: 'revolut_pay' })).toBe('Revolut Pay')
    expect(paidWithLabel({ method: 'mobilepay' })).toBe('MobilePay')
    expect(paidWithLabel({ method: 'other' })).toBe('Stripe')
    expect(methodLabel('something_new')).toBe('Stripe')
    expect(methodLabel('constructor')).toBe('Stripe')
  })

  it('is null without a payment', () => {
    expect(paidWithLabel(undefined)).toBeNull()
    expect(paidWithLabel(null)).toBeNull()
  })
})

describe('orderPaidParts', () => {
  it('lists the gift card first, then the rest', () => {
    expect(orderPaidParts({ giftCard: { last4: '1234', debitedOre: 10000 }, paidWith: { method: 'swish' } }))
      .toEqual(['Presentkort ****1234', 'Swish'])
    expect(orderPaidParts({ giftCard: { last4: '1234', debitedOre: 10000 } })).toEqual(['Presentkort ****1234'])
    expect(orderPaidParts({ giftCard: { debitedOre: 10000 } })).toEqual(['Presentkort'])
    expect(orderPaidParts({ giftCard: { last4: '1234', debitedOre: 0 }, paidWith: { method: 'card' } })).toEqual(['Kort'])
    expect(orderPaidParts({})).toEqual([])
  })
})

describe('refundFailedText', () => {
  it('says what happened and that the restaurant pays back', () => {
    expect(refundFailedText([{ amount: 25000, method: 'swish' }], kr)).toBe(
      'Återbetalningen på 250 kr kom inte fram (Swish). Pengarna är tillbaka på ert Stripe-saldo: betala tillbaka till gästen på annat sätt.',
    )
    expect(refundFailedText([{ amount: 10000 }], kr, 'kunden')).toBe(
      'Återbetalningen på 100 kr kom inte fram. Pengarna är tillbaka på ert Stripe-saldo: betala tillbaka till kunden på annat sätt.',
    )
  })

  it('adds up several failures', () => {
    expect(refundFailedText([{ amount: 10000, method: 'swish' }, { amount: 5000, method: 'swish' }], kr))
      .toMatch(/^2 återbetalningar på totalt 150 kr kom inte fram \(Swish\)\./)
  })

  it('is null when nothing failed', () => {
    expect(refundFailedText(undefined, kr)).toBeNull()
    expect(refundFailedText([], kr)).toBeNull()
    expect(refundFailedText([{ amount: 0 }], kr)).toBeNull()
  })
})
