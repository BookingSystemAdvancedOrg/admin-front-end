import { describe, expect, it } from 'vitest'
import { trendOf } from './trend'

describe('trendOf', () => {
  it('is green when a more-is-better number grows past the threshold', () => {
    const t = trendOf(11_200_00, 10_000_00, 'revenue', 'förra veckan')
    expect(t).toEqual({ tone: 'good', direction: 'up', text: '+12 %', spoken: 'upp 12 % mot förra veckan' })
  })

  it('is red when a more-is-better number falls', () => {
    const t = trendOf(90, 100, 'bookings', 'förra perioden')
    expect(t.tone).toBe('bad')
    expect(t.text).toBe('-10 %')
    expect(t.spoken).toBe('ned 10 % mot förra perioden')
  })

  it('turns the colours around for numbers where fewer is better', () => {
    expect(trendOf(3, 6, 'noShows', 'förra perioden').tone).toBe('good')
    expect(trendOf(6, 3, 'noShows', 'förra perioden').tone).toBe('bad')
    expect(trendOf(12, 15, 'prepTime', 'förra perioden').tone).toBe('good')
    expect(trendOf(4, 2, 'cancellations', 'förra perioden').tone).toBe('bad')
  })

  it('shows the difference, not a percentage, for small counts like unprinted tickets', () => {
    const t = trendOf(2, 5, 'unprinted', 'i går')
    expect(t).toEqual({ tone: 'good', direction: 'down', text: '-3', spoken: 'ned 3 mot i går' })
    expect(trendOf(4, 1, 'failedPayments', 'i går').tone).toBe('bad')
  })

  it('keeps noise neutral under the threshold for each metric', () => {
    // +1 % omsättning är brus.
    const t = trendOf(10_100_00, 10_000_00, 'revenue', 'förra veckan')
    expect(t.tone).toBe('neutral')
    expect(t.text).toBe('+1 %')
    // Stora procent men liten skillnad: en bokning mer på två är inget betyg i kronor, men räknas i antal.
    expect(trendOf(150_00, 100_00, 'revenue', 'x').tone).toBe('neutral')
    expect(trendOf(3, 2, 'bookings', 'x').tone).toBe('good')
  })

  it('is neutral on zero: a reset or a day that has just started', () => {
    expect(trendOf(0, 12_000_00, 'revenue', 'samma tid förra veckan')).toEqual({ tone: 'neutral', direction: null, text: '', spoken: '' })
    expect(trendOf(0, 4, 'noShows', 'förra perioden').tone).toBe('neutral')
  })

  it('is neutral without a comparison', () => {
    expect(trendOf(10, null, 'orders', 'x').text).toBe('')
    expect(trendOf(null, 10, 'orders', 'x').tone).toBe('neutral')
    expect(trendOf(10, undefined, 'orders', 'x').tone).toBe('neutral')
    expect(trendOf(Number.NaN, 10, 'orders', 'x').tone).toBe('neutral')
  })

  it('calls growth from nothing new, not green', () => {
    expect(trendOf(5, 0, 'orders', 'förra perioden')).toEqual({
      tone: 'neutral',
      direction: 'up',
      text: 'ny',
      spoken: 'nytt mot förra perioden, inget att jämföra med',
    })
  })

  it('says unchanged when nothing moved', () => {
    expect(trendOf(40, 40, 'guests', 'förra perioden')).toEqual({
      tone: 'neutral',
      direction: 'flat',
      text: 'oförändrat',
      spoken: 'oförändrat mot förra perioden',
    })
  })

  it('uses one decimal under ten percent', () => {
    expect(trendOf(1045, 1000, 'visits', 'x').text).toBe('+4,5 %')
  })
})
