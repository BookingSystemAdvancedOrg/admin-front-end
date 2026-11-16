import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCorpus } from '../../../scripts/help-corpus.mjs'
import type { HelpView } from './kb'

vi.mock('../auth/cognito', () => ({
  AuthUnavailableError: class AuthUnavailableError extends Error {},
  getAccessToken: vi.fn(() => Promise.resolve('tok')),
  refreshAfterUnauthorized: vi.fn(() => Promise.resolve(null)),
}))

const json = (code: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json', ...headers } })

const VIEW: HelpView = { role: 'owner_user', features: { reservations: true }, staffInsights: true }
const ANSWER = { text: 'Från servern.', steps: [], actions: [] }

/** Assistentens anrop mot API:t; kunskapsbasen (help-corpus.json) finns, eller inte. */
async function load(answers: (init: RequestInit) => Promise<Response>, corpus = true) {
  vi.resetModules()
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    if (url.endsWith('help-corpus.json')) {
      return corpus ? Promise.resolve(json(200, buildCorpus())) : Promise.reject(new TypeError('Failed to fetch'))
    }
    return answers(init)
  })
  vi.stubGlobal('fetch', fetchMock)
  const api = await import('./helpApi')
  const { DATA_CHANGED_EVENT } = await import('../../shared/api')
  const answerCalls = () => fetchMock.mock.calls.filter(([url]) => !url.endsWith('help-corpus.json')).length
  return { ...api, DATA_CHANGED_EVENT, answerCalls }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('askHelp', () => {
  it('asks quietly: no data-changed signal, so open pages do not refetch', async () => {
    const h = await load(async () => json(200, { answer: ANSWER }))
    const changed = vi.fn()
    window.addEventListener(h.DATA_CHANGED_EVENT, changed)
    await expect(h.askHelp('Hur?', [], VIEW)).resolves.toEqual(ANSWER)
    expect(changed).not.toHaveBeenCalled()
    window.removeEventListener(h.DATA_CHANGED_EVENT, changed)
  })

  it('never retries a 429, even with a short Retry-After', async () => {
    const h = await load(async () => json(429, { error: 'too_many_requests' }, { 'Retry-After': '1' }))
    await expect(h.askHelp('Hur?', [], VIEW)).rejects.toBeInstanceOf(h.HelpLimited)
    expect(h.answerCalls()).toBe(1)
  })

  it('switched off: no answer from the local corpus', async () => {
    const h = await load(async () => json(403, { error: 'help_assistant_off' }))
    await expect(h.askHelp('Hur lägger jag till en rätt?', [], VIEW)).rejects.toBeInstanceOf(h.HelpOff)
  })

  it('a server error falls back to the local corpus', async () => {
    const h = await load(async () => json(503, { error: 'service_unavailable', requestId: 'req-1' }))
    const answer = await h.askHelp('Hur lägger jag till en rätt?', [], VIEW)
    expect(answer.text).not.toBe('')
  })

  it('aborts after 20 s and answers from the local corpus', async () => {
    vi.useFakeTimers()
    const h = await load((init) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = h.askHelp('Hur lägger jag till en rätt?', [], VIEW)
    await vi.advanceTimersByTimeAsync(h.HELP_TIMEOUT_MS - 1)
    let settled = false
    void pending.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    const answer = await pending
    expect(answer.text).not.toBe('')
  })

  it('Booqys fel when the local corpus fails too, with the server request id', async () => {
    const h = await load(async () => json(500, { error: 'internal_error', requestId: 'abc-123' }), false)
    const err = await h.askHelp('Hur?', [], VIEW).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(h.HelpUnavailable)
    expect(err).toMatchObject({ code: 'internal_error', status: 500, requestId: 'abc-123' })
  })
})
