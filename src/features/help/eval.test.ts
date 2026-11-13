import { describe, expect, it } from 'vitest'
import { buildCorpus } from '../../../scripts/help-corpus.mjs'
import cases from './helpKbCases.json'
import { FEATURE_KEYS } from '../../shared/contracts'
import type { HelpView } from './kb'
import { OWNER_TEXT, REFUSE_TEXT, UNKNOWN_TEXT, answerLocally } from './retrieve'

/**
 * Utvärderingen: riktiga frågor mot kunskapsbasen som byggs ur koden just
 * nu. Samma frågor körs mot servern (application/tests/test_help_assistant.py).
 * Ett nytt fält, en ny sida eller en ändrad text som bryter ett svar syns här.
 */

type Expect = {
  source?: string
  route?: string
  hash?: string
  query?: Record<string, string>
  pageAction?: string
  highlight?: string[]
  live?: string | null
  answer?: 'owner' | 'refuse' | 'unknown'
}
type Case = { question: string; role: 'owner_user' | 'staff_user'; features: string[] | 'all'; staffInsights?: boolean; expect: Expect }

const corpus = buildCorpus()

function viewFor(c: Case): HelpView {
  const keys = c.features === 'all' ? FEATURE_KEYS : c.features
  return { role: c.role, features: Object.fromEntries(keys.map((f) => [f, true])), staffInsights: c.staffInsights ?? true }
}

describe('help eval (admin)', () => {
  it('has at least 40 questions', () => expect(cases.length).toBeGreaterThanOrEqual(40))

  it.each(cases as Case[])('$role: $question', (c) => {
    const a = answerLocally(corpus, c.question, viewFor(c))
    const e = c.expect
    if (e.answer) {
      expect(a.known).toBe(false)
      expect(a.steps).toEqual([])
      expect(a.text).toBe({ owner: OWNER_TEXT, refuse: REFUSE_TEXT, unknown: UNKNOWN_TEXT }[e.answer])
      return
    }
    expect(a.known).toBe(true)
    if (e.source) expect(a.sources[0]).toBe(e.source)
    const act = a.actions[0]
    if (e.route || e.hash || e.query || e.pageAction || e.highlight) expect(act, 'en knapp').toBeTruthy()
    if (e.route) expect(act.to).toBe(e.route)
    if (e.hash) expect(act.hash).toBe(e.hash)
    if (e.query) expect(act.query).toEqual(e.query)
    if (e.pageAction) expect(act.pageAction).toBe(e.pageAction)
    for (const h of e.highlight ?? []) expect(act.highlight ?? []).toContain(h)
    if (e.live !== undefined) expect(a.live?.metric ?? null).toBe(e.live)
  })
})
