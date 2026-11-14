#!/usr/bin/env node
// Kopierar kunskapsbasen som byggs ur koden och utvärderingsfrågorna till
// servern, som reserv om appens public/help-corpus.json inte går att hämta
// och för serverns tester:
//   (byggd)                              -> ../application/shared/help_corpus_admin.json
//   src/features/help/helpKbCases.json   -> ../application/shared/help_cases_admin.json
//   src/features/help/helpDateCases.json -> ../application/tests/help_dates_cases.json
//
//   node scripts/sync-help-kb.mjs           # skriv
//   node scripts/sync-help-kb.mjs --check   # skriv inget, exit 1 om de skiljer sig
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCorpus } from './help-corpus.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = resolve(root, '../application/shared')
if (!existsSync(app)) {
  console.error(`hittar inte ${app}`)
  process.exit(1)
}
const files = [
  ['help_corpus_admin.json', buildCorpus()],
  ['help_cases_admin.json', JSON.parse(readFileSync(resolve(root, 'src/features/help/helpKbCases.json'), 'utf8'))],
  ['../tests/help_dates_cases.json', JSON.parse(readFileSync(resolve(root, 'src/features/help/helpDateCases.json'), 'utf8'))],
]
const check = process.argv.includes('--check')
let diff = false
for (const [name, value] of files) {
  const text = `${JSON.stringify(value, null, 1)}\n`
  const target = resolve(app, name)
  if ((existsSync(target) ? readFileSync(target, 'utf8') : '') === text) continue
  diff = true
  if (check) console.error(`${name} skiljer sig; kör npm run help-kb:sync`)
  else writeFileSync(target, text)
}
process.exit(check && diff ? 1 : 0)
