import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from './api'
import { errorCode, errorText, focusErrorField } from './errors'

const server = (status: number, message: string, opts: { code?: string; field?: string } = {}) =>
  new ApiError(status, message, { ...opts, fromServer: true })

describe('errorText', () => {
  it('visar aldrig serverns råtext', () => {
    const texts = [
      errorText(server(400, 'partySize must be at most 50', { code: 'invalid_value', field: 'partySize' }), 'Kunde inte spara.'),
      errorText(server(500, 'Internal Server Error'), 'Kunde inte spara.'),
      errorText(server(502, 'stripe_refused_xyz'), 'Kunde inte spara.'),
      errorText(new TypeError('Failed to fetch'), 'Kunde inte spara.'),
      errorText(new Error('offline'), 'Kunde inte spara.'),
      errorText({ some: 'object' }, 'Kunde inte spara.'),
      errorText('raw string', 'Kunde inte spara.'),
    ]
    for (const text of texts) {
      expect(text).not.toMatch(/partySize|Internal Server|stripe_|Failed to fetch|offline|object Object|raw string/)
      expect(text).toMatch(/^[A-ZÅÄÖ].*\.$/)
    }
  })

  it('säger vad som hände och vad man kan göra', () => {
    expect(errorText(server(503, 'catering service unavailable', { code: 'catering_service_unavailable' }), 'Kunde inte spara.'))
      .toBe('Kunde inte spara. Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.')
    expect(errorText(server(400, 'name is required', { code: 'required', field: 'name' }), 'Kunde inte spara.'))
      .toMatch(/obligatoriskt fält/)
    expect(errorText(server(404, 'not found', { code: 'not_found' }), 'Kunde inte spara.')).toMatch(/Ladda om sidan/)
  })

  it('gemensamma koder har samma text överallt', () => {
    expect(errorText(new NetworkError())).toMatch(/^Ingen kontakt med servern/)
    expect(errorText(server(403, 'tenant_inactive'))).toMatch(/pausat/)
    expect(errorText(server(429, 'too_many_requests'))).toMatch(/Vänta en minut/)
    expect(errorText(server(409, 'changed_retry'))).toMatch(/Ladda om/)
    expect(errorText(server(401, 'Unauthorized', { code: 'unauthorized' }))).toMatch(/Logga in igen/)
  })

  it('sidans egna texter och fältnamn går före', () => {
    expect(errorText(server(409, 'table_taken'), 'X.', { table_taken: 'Bordet är upptaget.' })).toBe('Bordet är upptaget.')
    expect(errorText(server(400, 'lines[2].price must be positive', { code: 'invalid_value', field: 'lines[2].price' }),
      'Kunde inte spara.', {}, { lines: 'raderna' })).toBe('Kunde inte spara. Kontrollera raderna och försök igen.')
    expect(errorText(server(400, 'accounts.sales must be 4 digits', { code: 'invalid_value', field: 'accounts.sales' }),
      'Kunde inte spara.', {}, { accounts: 'kontonumren' })).toBe('Kunde inte spara. Kontrollera kontonumren och försök igen.')
  })

  it('redan översatta fel visas som de är', () => {
    expect(errorText(new ApiError(409, 'Bordet har hunnit bokas.'), 'X.')).toBe('Bordet har hunnit bokas.')
    expect(errorText(new Error('Lösenordet är för kort.'), 'X.')).toBe('Lösenordet är för kort.')
  })

  it('errorCode känner igen fel som aldrig nådde fram', () => {
    expect(errorCode(new TypeError('Failed to fetch'))).toBe('network')
    expect(errorCode(new DOMException('t', 'TimeoutError'))).toBe('timeout')
    expect(errorCode(server(409, 'table_taken'))).toBe('table_taken')
  })
})

describe('focusErrorField', () => {
  it('flyttar fokus till fältet servern pekade ut och markerar det', () => {
    document.body.innerHTML = '<input id="dish-price" value="99999"><input id="dish-name">'
    const err = new ApiError(400, 'price may be at most 10000 kr', { fromServer: true, field: 'price' })
    expect(focusErrorField(err, { price: 'dish-price', name: 'dish-name' })).toBe(true)
    const input = document.getElementById('dish-price') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    input.dispatchEvent(new Event('input'))
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('gör ingenting utan fält eller okänt fält', () => {
    expect(focusErrorField(new Error('x'), { price: 'dish-price' })).toBe(false)
    expect(focusErrorField(new ApiError(400, 'x', { field: 'other' }), { price: 'dish-price' })).toBe(false)
  })
})
