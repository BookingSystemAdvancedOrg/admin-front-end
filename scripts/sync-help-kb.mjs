#!/usr/bin/env node
// Kopierar hjälpassistentens kunskapsbas och testfrågor till servern:
//   src/features/help/helpKb.json      -> ../application/shared/help_kb.json
//   src/features/help/helpKbCases.json -> ../application/shared/help_kb_cases.json
//
//   node scripts/sync-help-kb.mjs           # skriv
//   node scripts/sync-help-kb.mjs --check   # skriv inget, exit 1 om de skiljer sig
//
// Admin är källan (texterna hör till sidorna här); application/tests
// kontrollerar samma sak när admin-front-end ligger bredvid.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(root, '../application/shared')
const pairs = [
  ['src/features/help/helpKb.json', 'help_kb.json'],
  ['src/features/help/helpKbCases.json', 'help_kb_cases.json'],
]
const check = process.argv.includes('--check')
if (!existsSync(app)) {
  console.error(`hittar inte ${app}`)
  process.exit(1)
}
let diff = false
for (const [from, to] of pairs) {
  const text = `${JSON.stringify(JSON.parse(readFileSync(resolve(root, from), 'utf8')), null, 2)}\n`
  const target = resolve(app, to)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (current === text) continue
  diff = true
  if (check) console.error(`${to} skiljer sig från ${from}; kör npm run help-kb:sync`)
  else writeFileSync(target, text)
}
process.exit(check && diff ? 1 : 0)
