import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  AuthUnavailableError: class AuthUnavailableError extends Error {},
  getAccessToken: vi.fn(() => Promise.resolve<string | null>('tok')),
  refreshAfterUnauthorized: vi.fn(() => Promise.resolve<string | null>('tok2')),
}))

vi.mock('../features/auth/cognito', () => ({
  AuthUnavailableError: auth.AuthUnavailableError,
  getAccessToken: auth.getAccessToken,
  refreshAfterUnauthorized: auth.refreshAfterUnauthorized,
}))

async function loadApi() {
  vi.resetModules()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
  return import('./api')
}

const json = (code: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json', ...headers } })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  auth.getAccessToken.mockClear()
  auth.refreshAfterUnauthorized.mockClear()
})

describe('apiFetch omförsök', () => {
  it('köksskärmen försöker igen när API:t är tillfälligt upptaget', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(429, { message: 'Too Many Requests' }))
      .mockResolvedValueOnce(json(503, { error: 'x' }))
      .mockResolvedValueOnce(json(200, { items: [1] }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await loadApi()

    await expect(apiFetch('/locations/l/orders')).resolves.toEqual({ items: [1] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
  })

  it('en statusändring (POST) försöker igen bara vid 429, aldrig vid 503', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(503, { error: 'x' }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await loadApi()

    await expect(apiFetch('/x', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('apiFetch fel', () => {
  it('bär API:ts kod och fält, och servern markeras som källa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(400, { error: 'partySize must be at most 50', code: 'invalid_value', field: 'partySize' })))
    const { apiFetch } = await loadApi()
    await expect(apiFetch('/x', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 400, code: 'invalid_value', field: 'partySize', fromServer: true, message: 'partySize must be at most 50',
    })
  })

  it('en kod i error-fältet är koden; gatewayens text och HTML får statusens kod', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(409, { error: 'table_taken' }))
      .mockResolvedValueOnce(json(500, { message: 'Internal Server Error' }))
      .mockResolvedValueOnce(new Response('<html>502</html>', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await loadApi()
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toMatchObject({ code: 'table_taken' })
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toMatchObject({ code: 'internal_error' })
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toMatchObject({ code: 'internal_error', status: 502 })
  })

  it('ingen anslutning blir ett NetworkError med svensk text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { apiFetch } = await loadApi()
    await expect(apiFetch('/x', { method: 'POST' })).rejects.toMatchObject({
      name: 'NetworkError', code: 'network', message: expect.stringMatching(/^Ingen kontakt med servern/),
    })
  })
})

describe('apiFetch och ett 401', () => {
  it('förnyar tokenen en gång och försöker anropet igen, utan att logga ut', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await loadApi()

    await expect(apiFetch('/tenant')).resolves.toEqual({ ok: true })
    expect(auth.refreshAfterUnauthorized).toHaveBeenCalledTimes(1)
    expect(auth.refreshAfterUnauthorized).toHaveBeenCalledWith('tok')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok2')
  })

  it('försöker bara en gång: ett nytt 401 efter förnyelsen blir felet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(401, { message: 'Unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await loadApi()

    await expect(apiFetch('/tenant')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(auth.refreshAfterUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('utloggad på riktigt: inget nytt anrop', async () => {
    auth.refreshAfterUnauthorized.mockResolvedValueOnce(null)
    const fetchMock = vi.fn().mockResolvedValue(json(401, { message: 'Unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)
    const { apiFetch } = await loadApi()

    await expect(apiFetch('/tenant')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('servern nås inte för att förnya: nätverksfel, inte utloggad', async () => {
    auth.getAccessToken.mockRejectedValueOnce(new auth.AuthUnavailableError())
    vi.stubGlobal('fetch', vi.fn())
    const { apiFetch, NetworkError } = await loadApi()

    await expect(apiFetch('/tenant')).rejects.toBeInstanceOf(NetworkError)
  })
})
