import { ApiError, apiFetch, isApiConfigured } from '../../shared/api'
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

export class HelpLimited extends Error {}

export async function askHelp(question: string, history: HelpTurn[], view: HelpView): Promise<HelpAnswer> {
  const previous = [...history].reverse().find((t) => t.role === 'user')?.text ?? ''
  if (!isApiConfigured()) return answerLocally(question, view, previous)
  try {
    const res = await apiFetch<{ answer: HelpAnswer }>('/tenant/help-assistant/answers', {
      method: 'POST',
      body: JSON.stringify({ question, history: history.slice(-4) }),
    })
    return res.answer
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) throw new HelpLimited()
    // Servern svarar inte: hjälptexterna finns ändå här.
    return answerLocally(question, view, previous)
  }
}
