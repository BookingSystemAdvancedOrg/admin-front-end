import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { describeError } from './errors'
import { appVersion, reportPayload } from './supportReport'

describe('Rapportera till Booqy', () => {
  it('skickar bara kod, status, sökväg, request id och version', () => {
    const err = new ApiError(500, 'Traceback: password=hunter2 token=eyJabc', { fromServer: true, requestId: 'Xy12=' })
    const info = describeError(err, 'Kunde inte spara gästen Anna Svensson.')
    const payload = reportPayload(info, '/gaster/123')
    expect(Object.keys(payload).sort()).toEqual(['appVersion', 'code', 'path', 'requestId', 'status'])
    expect(payload).toMatchObject({ code: 'internal_error', status: 500, path: '/gaster/123', requestId: 'Xy12=' })
    const sent = JSON.stringify(payload)
    for (const secret of ['hunter2', 'eyJ', 'Anna', 'Svensson', 'Traceback', 'Bearer']) expect(sent).not.toContain(secret)
  })

  it('tar aldrig med frågesträng eller # (återställningskoder, sökningar)', () => {
    const info = describeError(new ApiError(503, 'x', { fromServer: true }))
    expect(reportPayload(info, '/aterstall-losenord?code=123456#email=a@b.se').path).toBe('/aterstall-losenord')
  })

  it('en kod som inte ser ut som en kod skickas inte som den är', () => {
    const info = { ...describeError(new ApiError(500, 'x', { fromServer: true })), code: 'AccessDenied' }
    expect(reportPayload(info, '/').code).toBe('accessdenied')
    expect(reportPayload({ ...info, code: 'Hej Anna!' }, '/').code).toBe('hej_anna_')
  })

  it('versionen är hashen i huvudskriptets namn', () => {
    const doc = document.implementation.createHTMLDocument('x')
    expect(appVersion(doc)).toBe('dev')
    const s = doc.createElement('script')
    s.type = 'module'
    s.setAttribute('src', '/assets/index-Ab12_cD.js')
    doc.head.appendChild(s)
    expect(appVersion(doc)).toBe('Ab12_cD')
  })
})
