import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../features/auth/cognito', () => ({ getAccessToken: () => Promise.resolve('tok') }))

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
