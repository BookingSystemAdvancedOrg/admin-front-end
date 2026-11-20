// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Ägaren 2026-11-18: varje kant i appen är genomskinlig (shared/edges.css).
const src = fileURLToPath(new URL('./', import.meta.url))
const read = (rel: string) => readFileSync(join(src, rel), 'utf8')

function cssFiles(dir: string): string[] {
  return readdirSync(join(src, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith('.css') ? [join(dir, e.name)] : [],
  )
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Tokens som färgar en kant. Alla måste vara genomskinliga överallt. */
const EDGE_TOKENS = [
  '--border',
  '--hairline',
  '--hairline-strong',
  '--glass-border',
  '--field-border',
  '--field-border-hover',
  '--dock-pill-edge',
  '--paper-line',
  '--tile-edge',
]

describe('no edges', () => {
  const layer = stripComments(read('shared/edges.css'))

  it('loads the global layer last in main.tsx', () => {
    const imports = read('main.tsx')
      .split('\n')
      .filter((l) => /^import /.test(l))
    expect(imports.at(-1)).toBe("import './shared/edges.css'")
  })

  it('makes every border colour transparent, also on pseudo elements', () => {
    expect(layer).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*border-color:\s*transparent\s*!important/)
    expect(layer).toMatch(/column-rule-color:\s*transparent\s*!important/)
    expect(layer).toMatch(/hr\s*\{[^}]*border-color:\s*transparent\s*!important/)
  })

  it('never hides the keyboard focus ring', () => {
    expect(layer).not.toMatch(/outline/)
    expect(layer).not.toMatch(/focus/)
  })

  it('forces the edge tokens to transparent in light and dark', () => {
    for (const token of ['--border', '--hairline', '--glass-border', '--field-border', '--bq-line', '--bq-line-strong']) {
      expect(layer).toMatch(new RegExp(`${token}:\\s*transparent\\s*!important`))
    }
    expect(layer).toMatch(/:root\[data-theme='dark'\]/)
    expect(layer).toMatch(/:root\[data-theme='light'\]/)
  })

  it('defines every edge token as transparent in every theme file', () => {
    const offenders: string[] = []
    for (const file of cssFiles('.')) {
      const css = stripComments(read(file))
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
        const [, name, value] = m
        if (!EDGE_TOKENS.includes(name)) continue
        const v = value.replace(/\s*!important\s*$/, '').trim()
        if (v !== 'transparent' && !/^var\(--(border|paper-line|field-border|hairline)[a-z-]*\)$/.test(v)) {
          offenders.push(`${file}: ${name}: ${v}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the light 1px highlights and rim rings transparent', () => {
    const offenders: string[] = []
    for (const file of cssFiles('.')) {
      const css = stripComments(read(file))
      for (const m of css.matchAll(/(box-shadow|--rim|--liquid-edge|--field-inset)\s*:\s*([^;}]+)/g)) {
        // tunna ringar (0 0 0 1-2px) och 1 px-linjer (inset 0 ±1px 0) med en färg
        for (const layerValue of m[2].split(/,(?![^(]*\))/)) {
          const t = layerValue.trim()
          const ring = /^(inset\s+)?0 0 0 (1|1\.5|2)px\s+(?!transparent)\S/.test(t)
          const line = /^inset\s+0\s+-?1px\s+0\s+(?!transparent)\S/.test(t) || /^0\s+1px\s+0\s+(?!transparent)\S/.test(t)
          if ((ring || line) && !/--focus|--field-ring/.test(t)) offenders.push(`${file}: ${t}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('draws no solid ring of any width (3px frames included) outside focus rules', () => {
    // En regel räknas som fokusregel bara när varje selektor i den är en fokusselektor.
    const topLevel = (selector: string) => {
      const parts: string[] = []
      let depth = 0
      let cur = ''
      for (const ch of selector) {
        if (ch === ',' && depth === 0) {
          parts.push(cur)
          cur = ''
          continue
        }
        if (ch === '(') depth++
        if (ch === ')') depth--
        cur += ch
      }
      return [...parts, cur].map((s) => s.trim()).filter(Boolean)
    }
    const isFocusRule = (selector: string) => topLevel(selector).every((s) => /:focus/.test(s))
    const offenders: string[] = []
    for (const file of cssFiles('.')) {
      const css = stripComments(read(file))
      for (const rule of css.matchAll(/([^{};]*)\{([^{}]*)\}/g)) {
        const selector = rule[1].trim()
        if (isFocusRule(selector)) continue
        for (const d of rule[2].matchAll(/box-shadow\s*:\s*([^;}]+)/g)) {
          for (const layerValue of d[1].split(/,(?![^(]*\))/)) {
            const t = layerValue.trim()
            const m = /^(?:inset\s+)?0 0 0 ([\d.]+)px\s+(\S.*)$/.exec(t)
            // alla bredder (även fokusfärgade ringar utanför fokusregler); 100px och mer är en ton eller ett dimlager (inset-fyllnad, guidens mörkläggning), ingen kant
            if (!m || Number(m[1]) === 0 || Number(m[1]) >= 100) continue
            const colour = m[2].replace(/\s*!important\s*$/, '').trim()
            if (colour === 'transparent') continue
            offenders.push(`${file}: ${selector} ${t}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('removes the brand package rings that use non-edge colours', () => {
    expect(layer).toMatch(/\.bq-btn--secondary:hover:not\(:disabled\)\s*\{\s*box-shadow:\s*var\(--bq-shadow-sm\)\s*!important/)
    expect(layer).toMatch(/\.bq-card--danger\s*\{\s*box-shadow:\s*var\(--bq-shadow-md\)\s*!important/)
  })

  it('keeps icons drawn with borders visible (checkmark, chevrons)', () => {
    expect(layer).toMatch(/\.bq-check::after\s*\{[^}]*border-color:\s*var\(--on-accent\)\s*!important/)
    expect(layer).toMatch(/\.admin-nav-chevron[^{]*\{[^}]*border-color:\s*currentColor\s*!important/)
  })
})
