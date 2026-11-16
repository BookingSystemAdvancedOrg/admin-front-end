import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS } from '../../shared/contracts'
import { buildCorpus, helpSlug, settingsSections } from '../../../scripts/help-corpus.mjs'
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

  it('gives every settings row and settings tab a data-help id (CI coverage check)', () => {
    const settings = readFileSync(join(SRC, 'features/installningar/InstallningarPage.tsx'), 'utf8')
    const rows = [...settings.matchAll(/<div className="settings-row"[^>]*>/g)].map((m) => m[0])
    expect(rows.length).toBeGreaterThan(5)
    for (const row of rows) expect(row, 'settings-row utan data-help').toMatch(/data-help="settings:\w+:\w+"/)
    expect(settings).toMatch(/data-help=\{`settings-tab:\$\{t\}`\}/)
    // Menyvalen får sitt id från nav.ts i AdminLayout.
    expect(readFileSync(join(SRC, 'shared/AdminLayout.tsx'), 'utf8')).toMatch(/data-help=\{`nav:\$\{item\.to\}`\}/)
  })

  it('only highlights data-help ids that exist in the code', () => {
    const code = sources(SRC).join('\n')
    const literal = new Set([...code.matchAll(/data-help="([^"]+)"/g)].map((m) => m[1]))
    const computed = new Set([...code.matchAll(/<(?:Tile|StatTile)\b[^>]*?label="([^"]+)"/g)].map((m) => `kpi:${helpSlug(m[1])}`))
    for (const m of code.matchAll(/<Card\b[^>]*?label="([^"]+)"/g)) computed.add(`card:${helpSlug(m[1])}`)
    const navTo = [...readFileSync(join(SRC, 'shared/nav.ts'), 'utf8').matchAll(/to: '([^']+)'/g)].map((m) => `nav:${m[1]}`)
    const tabs = [...code.matchAll(/data-help="settings:(\w+):/g)].map((m) => `settings-tab:${m[1]}`)
    const known = new Set([...literal, ...computed, ...navTo, ...tabs])
    const used = buildCorpus().docs.flatMap((d) => [...(d.highlight ?? []), ...(d.actions ?? []).flatMap((a) => a.highlight ?? [])])
    const missing = [...new Set(used.filter((h) => h.startsWith('help:')).map((h) => h.slice(5)))].filter((id) => !known.has(id))
    expect(missing, `data-help som inte finns: ${missing.join(', ')}`).toEqual([])
  })

  it('names settings as the menu does: Inställningar, group, tab', () => {
    // Menyn visar först grupperna (Verksamheten), sedan flikarna (Restaurang).
    const { tabLabel, groupOf } = settingsSections()
    const paths = new Set(Object.entries(tabLabel).map(([tab, label]) => `${groupOf[tab]}, ${label}`))
    const groups = new Set(Object.values(groupOf))
    const tabNames = Object.values(tabLabel).sort((a, b) => b.length - a.length)
    const texts = buildCorpus().docs.flatMap((d) => [d.answer ?? '', d.where ?? '', d.text ?? '', ...(d.steps ?? [])])
    for (const text of texts) {
      for (const m of text.matchAll(/Inställningar, (?!välj |så )([^.:]+?)(?=[.:]|$| om | så )/g)) {
        const rest = m[1].replace(/,$/, '')
        const ok = [...paths].some((p) => rest === p || rest.startsWith(`${p}, `)) || groups.has(rest)
        expect(ok, `"${text}" pekar inte på en grupp och flik i Inställningar`).toBe(true)
      }
      for (const m of text.matchAll(/Inställningar,? (?:och )?välj ([^.]+)\./g)) {
        const pick = /^(.+) och sedan (.+)$/.exec(m[1])
        expect(pick && paths.has(`${pick[1]}, ${pick[2]}`), `"${text}": skriv "Öppna Inställningar, välj <grupp> och sedan <flik>."`).toBe(true)
      }
      for (const name of tabNames) {
        expect(text.includes(`Inställningar, ${name}`) && !groups.has(name), `"${text}" saknar gruppen före ${name}`).toBe(false)
      }
    }
  })
})
