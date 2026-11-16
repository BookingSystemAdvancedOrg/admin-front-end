import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
import { loadCorpus } from './corpus'
import type { HelpAnswer, HelpView } from './kb'
import { answerLocally } from './retrieve'

/**
 * GET /tenant/help-assistant och POST /tenant/help-assistant/answers.
 * Utan API (mockdata, tester) svarar kunskapsbasen direkt i webbläsaren,
 * med samma regler som serverns svar utan språkmodell.
 */

export type HelpMode = 'ai' | 'kb' | 'off'
export type HelpTurn = { role: 'user' | 'assistant'; text: string }

export async function getHelpStatus(): Promise<{ enabled: boolean; mode: HelpMode }> {
  if (!isApiConfigured()) return { enabled: true, mode: 'kb' }
  try {
    return await apiFetch<{ enabled: boolean; mode: HelpMode }>('/tenant/help-assistant')
  } catch {
    // Saknas routen (äldre API) eller går den inte att nå: ingen assistent.
    return { enabled: false, mode: 'off' }
  }
}

/** 429: för många frågor på kort tid. Försöks aldrig om. */
export class HelpLimited extends Error {}

/** 403 help_assistant_off: Booqy har stängt av assistenten. Inget svar ur kunskapsbasen. */
export class HelpOff extends Error {}

/**
 * Varken servern eller kunskapsbasen gav ett svar: Booqys fel. Bär serverns
 * kod, status och requestId (när den skickade ett) till Rapportera till Booqy.
 */
export class HelpUnavailable extends Error {
  code: string
  status: number
  requestId?: string
  constructor(server: unknown) {
    super('help_unavailable')
    const api = server instanceof ApiError ? server : null
    this.code = api && api.status >= 500 ? api.code : 'help_unavailable'
    this.status = api?.status ?? 0
    if (api?.requestId) this.requestId = api.requestId
  }
}

/** Så länge väntar frågan på servern innan kunskapsbasen svarar i stället. */
export const HELP_TIMEOUT_MS = 20_000

async function locally(question: string, history: HelpTurn[], view: HelpView): Promise<HelpAnswer> {
  const previous = [...history].reverse().find((t) => t.role === 'user')?.text ?? ''
  return answerLocally(await loadCorpus(), question, view, previous)
}

export async function askHelp(question: string, history: HelpTurn[], view: HelpView): Promise<HelpAnswer> {
  if (!isApiConfigured()) {
    try {
      return await locally(question, history, view)
    } catch {
      throw new HelpUnavailable(null)
    }
  }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), HELP_TIMEOUT_MS)
  try {
    const res = await apiFetch<{ answer: HelpAnswer }>('/tenant/help-assistant/answers', {
      method: 'POST',
      quiet: true,
      signal: abort.signal,
      body: JSON.stringify({ question, history: history.slice(-4) }),
    })
    return res.answer
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) throw new HelpLimited()
    if (err instanceof ApiError && err.status === 403 && err.code === 'help_assistant_off') throw new HelpOff()
    // Servern svarar inte (fel, nätverk, 20 s): kunskapsbasen finns ändå här.
    try {
      return await locally(question, history, view)
    } catch {
      throw new HelpUnavailable(err)
    }
  } finally {
    clearTimeout(timer)
  }
}
