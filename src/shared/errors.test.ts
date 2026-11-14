import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from './api'
import { BOOQY_FAULT, booqyFaultText, describeError, errorCode, errorInfo, errorText, focusErrorField } from './errors'

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
      .toBe(`Kunde inte spara. ${BOOQY_FAULT}`)
    expect(errorText(server(400, 'name is required', { code: 'required', field: 'name' }), 'Kunde inte spara.'))
      .toMatch(/obligatoriskt fält/)
    expect(errorText(server(404, 'not found', { code: 'not_found' }), 'Kunde inte spara.')).toMatch(/tagits bort på annat håll/)
  })

  it('gemensamma koder har samma text överallt', () => {
    expect(errorText(new NetworkError())).toMatch(/^Ingen kontakt med servern/)
    expect(errorText(server(403, 'tenant_inactive'))).toMatch(/pausat/)
    expect(errorText(server(429, 'too_many_requests'))).toMatch(/Vänta en minut/)
    expect(errorText(server(409, 'changed_retry'))).toMatch(/Det senaste visas nu/)
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

describe('vem gör något', () => {
  const who = (err: unknown, known: Record<string, string> = {}) => describeError(err, 'Kunde inte spara.', known)

  it('Booqys fel: 5xx, *_unavailable, internal_error, AccessDenied, timeout', () => {
    for (const err of [
      server(500, 'Internal Server Error'),
      server(502, 'Bad Gateway'),
      server(503, 'x', { code: 'service_unavailable' }),
      server(503, 'x', { code: 'fortnox_unavailable' }),
      server(500, 'x', { code: 'internal_error' }),
      server(403, 'AccessDenied', { code: 'AccessDenied' }),
      server(403, 'x', { code: 'access_denied' }),
      new DOMException('t', 'TimeoutError'),
    ]) {
      const info = who(err)
      expect(info.actor, info.code).toBe('booqy')
      expect(info.text).toMatch(/Booqy/)
      expect(info.link).toBeUndefined()
    }
  })

  it('okända koder räknas som Booqys fel', () => {
    for (const err of [server(400, 'x', { code: 'weird_new_thing' }), server(418, 'teapot'), new Error('x'), 'raw', { a: 1 }]) {
      const info = who(err)
      expect(info.actor).toBe('booqy')
      expect(info.text).toBe(`Kunde inte spara. ${BOOQY_FAULT}`)
    }
  })

  it('användarens fel säger vad man gör, och leder till rätt ställe när det finns ett', () => {
    expect(who(server(403, 'dpa_version_outdated')).link).toEqual({ to: '/avtal', label: 'Öppna Avtal' })
    expect(who(server(403, 'dpa_version_outdated')).text).toMatch(/under Avtal/)
    expect(who(server(403, 'feature_not_in_plan')).link?.to).toBe('/installningar#profil')
    expect(who(server(409, 'no_stripe_account')).link?.to).toBe('/installningar#betalningar')
    expect(who(server(401, 'Unauthorized', { code: 'unauthorized' })).link?.to).toBe('/logga-in')
    for (const err of [
      new NetworkError(),
      server(400, 'x', { code: 'required', field: 'name' }),
      server(400, 'x', { code: 'invalid_value' }),
      server(404, 'not found', { code: 'not_found' }),
      server(409, 'changed_retry'),
      server(429, 'too_many_requests'),
      server(403, 'owner_only'),
    ]) {
      const info = who(err)
      expect(info.actor, info.code).toBe('user')
      expect(info.text).not.toMatch(/Booqy/)
    }
  })

  it('sidans egna texter behåller vem som gör något efter koden', () => {
    expect(who(server(502, 'x', { code: 'google_unavailable' }), { google_unavailable: 'Google svarar inte.' }))
      .toMatchObject({ text: 'Google svarar inte.', actor: 'booqy' })
    expect(who(server(409, 'table_taken'), { table_taken: 'Bordet är upptaget.' }))
      .toMatchObject({ text: 'Bordet är upptaget.', actor: 'user' })
    expect(who(new ApiError(503, 'Tjänsten svarar inte.'))).toMatchObject({ actor: 'booqy' })
  })

  it('ingen text slutar med ett ensamt "försök igen om en stund"', () => {
    const codes = ['network', 'timeout', 'internal_error', 'service_unavailable', 'stripe_unavailable', 'payment_unavailable',
      'invalid_json', 'no_tenant', 'tenant_inactive', 'x_unavailable']
    for (const code of codes) {
      expect(errorText(server(code === 'network' ? 0 : 503, code, { code }), 'Kunde inte spara.')).not.toMatch(/försök igen om en stund\.$/i)
    }
  })

  it('felrutan hittar vem som gör något utifrån texten, och request id följer med', () => {
    const text = errorText(new ApiError(500, 'Boom happened', { fromServer: true, requestId: 'abc=' }), 'Kunde inte spara.')
    expect(errorInfo(text)).toMatchObject({ actor: 'booqy', status: 500, code: 'internal_error', requestId: 'abc=' })
    expect(errorInfo('Fyll i namn.')).toBeUndefined()
    expect(errorInfo(booqyFaultText('Kunde inte hämta siffrorna.'))?.actor).toBe('booqy')
  })
})
