import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS } from '../../shared/contracts'
import { KB, PAGE_ACTIONS, ROUTE_PATTERNS } from './kb'

/**
 * Håller kunskapsbasen i takt med appen: varje route i App.tsx måste ha
 * minst en hjälptext, och varje knapp måste gå till en sida som finns.
 * Lägger du till en sida: skriv dess hjälp i helpKb.json och kör
 * `npm run help-kb:sync` så att servern får samma text.
 */

const SRC = resolve(__dirname, '../..')
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8')

// Routes som bara skickar vidare och därför inte behöver egen hjälptext.
const REDIRECTS = ['/settings/payments', '/ladda-ner']

function appRoutes(): string[] {
  const paths = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*')
  return [...(/<Route\s+index\b/.test(APP) ? ['/'] : []), ...paths.map((p) => `/${p}`)]
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [readFileSync(path, 'utf8')] : []
  })
}

describe('help knowledge base', () => {
  it('lists exactly the routes in App.tsx', () => {
    expect([...ROUTE_PATTERNS].sort()).toEqual(appRoutes().sort())
  })

  it('has help for every route', () => {
    const covered = new Set(KB.entries.map((e) => e.route))
    const missing = appRoutes().filter((r) => !REDIRECTS.includes(r) && !covered.has(r))
    expect(missing, `routes utan hjälptext i helpKb.json: ${missing.join(', ')}`).toEqual([])
  })

  it('only points at routes, forms and features that exist', () => {
    const code = sources(SRC).join('\n')
    for (const key of PAGE_ACTIONS) expect(code, `ingen sida tar emot ${key}`).toContain(`onPageAction('${key}'`)
    for (const e of KB.entries) {
      if (e.route !== null) expect(ROUTE_PATTERNS, e.id).toContain(e.route)
      for (const f of [e.feature ?? []].flat()) expect(FEATURE_KEYS, e.id).toContain(f)
      for (const a of e.actions ?? []) {
        expect(ROUTE_PATTERNS, a.id).toContain(a.to)
        expect(a.to, a.id).not.toContain(':')
        if (a.pageAction) expect(PAGE_ACTIONS, a.id).toContain(a.pageAction)
      }
    }
  })

  it('has unique ids, Swedish text without dashes and nothing sensitive', () => {
    const ids = KB.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const text = JSON.stringify(KB)
    expect(text).not.toMatch(/[\u2013\u2014]|&[nm]dash;/)
    expect(text).not.toMatch(/AKIA|arn:aws|sk_live|sk_test|pk_live|pk_test|whsec_|\b\d{12}\b|amazonaws|dynamodb|lambda|cognito|tenant_id/i)
    for (const e of KB.entries) {
      expect(e.steps.length + e.answer.length, e.id).toBeGreaterThan(0)
      expect(['all', 'owner'], e.id).toContain(e.audience)
    }
  })
})
