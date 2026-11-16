#!/usr/bin/env node
// Bygger hjälpassistentens kunskapsbas ur koden, så att den aldrig blir
// gammal: varje sida, menyval, inställning, rubrik, fält, knapp, förklaring,
// nyckeltal och element med data-help kommer med av sig själv, plus de
// kurerade guiderna i src/features/help/helpKb.json.
//
//   node scripts/help-corpus.mjs            # skriv public/help-corpus.json
//   node scripts/help-corpus.mjs --stdout   # skriv till standard ut
//
// Körs före dev, build och test (package.json). Filen följer med appen och
// servern hämtar den därifrån (help-assistant, HELP_CORPUS_URLS).
// Inga hemligheter: bara text som redan syns i appen, och allt som liknar en
// nyckel eller infrastruktur tas bort (SENSITIVE).
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

export const SENSITIVE =
  /AKIA|arn:aws|sk_live|sk_test|pk_live|pk_test|whsec_|\b\d{12}\b|amazonaws|dynamodb|lambda|cognito|tenant_id|password|secret|token/i

/** Samma regel som src/shared/helpId.ts. */
export function helpSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Sidor utan menyval: namn och vem som ser dem.
const EXTRA_PAGES = {
  '/cateringkalkyl': { label: 'Cateringinställningar', feature: 'catering', ownerOnly: true },
  '/avtal': { label: 'Avtal', ownerOnly: true },
}
// Inställningar: personalen kan bara ändra Utseende och ljud (och se skrivbordsappen),
// resten är ägarens. De som kräver en funktion i planen.
const SETTINGS_STAFF = ['utseende', 'skrivbordsappen']
const SETTINGS_FEATURE = { bestallning: 'ordering', skrivare: 'ordering' }
// Inte delar av den inloggade appen (eller assistenten själv).
const SKIP_DIRS = ['features/auth', 'features/help', 'test']

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

const clean = (t) => t.replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ').trim()
const usable = (t) => t.length >= 2 && t.length <= 160 && /[a-zåäö]/i.test(t) && !SENSITIVE.test(t) && !/[=;{}]|=>|\$\{/.test(t)

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const p of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    try {
      if (statSync(p).isFile()) return p
    } catch {
      /* finns inte */
    }
  }
  return null
}

function parseNav() {
  const nav = readFileSync(join(SRC, 'shared/nav.ts'), 'utf8')
  const items = []
  for (const m of nav.matchAll(/\{\s*to: '([^']+)', label: '([^']+)'([^}]*)\}/g)) {
    const rest = m[3]
    const feature = rest.match(/feature: (\[[^\]]*\]|'[^']+')/)?.[1]
    items.push({
      to: m[1],
      label: m[2],
      ownerOnly: /ownerOnly: true/.test(rest),
      insights: /insights: true/.test(rest),
      feature: feature ? (feature.startsWith('[') ? [...feature.matchAll(/'([^']+)'/g)].map((f) => f[1]) : feature.slice(1, -1)) : null,
    })
  }
  return items
}

function parseRoutes() {
  const app = readFileSync(join(SRC, 'App.tsx'), 'utf8')
  const pages = readFileSync(join(SRC, 'pages.ts'), 'utf8')
  const modules = Object.fromEntries([...pages.matchAll(/(\w+): \(\) => import\('\.\/([^']+)'\)/g)].map((m) => [m[1], m[2]]))
  const lazyOf = {}
  for (const m of app.matchAll(/const (\w+) = lazy\(([^\n]+)\)/g)) {
    const key = m[2].match(/pages\.(\w+)/)?.[1]
    if (key) lazyOf[m[1]] = modules[key]
  }
  const routes = []
  if (/<Route\s+index\s+element=\{<(\w+)/.test(app)) routes.push({ path: '/', comp: app.match(/<Route\s+index\s+element=\{<(\w+)/)[1] })
  for (const m of app.matchAll(/<Route path="([^"*]+)" element=\{<(\w+)/g)) routes.push({ path: `/${m[1]}`, comp: m[2] })
  const fileRoute = new Map()
  for (const r of routes) {
    const mod = lazyOf[r.comp]
    if (!mod || r.path.includes(':')) continue
    const file = resolveImport(join(SRC, 'x.ts'), `./${mod}`)
    if (file && !fileRoute.has(file)) fileRoute.set(file, r.path)
  }
  return { routes: routes.map((r) => r.path), fileRoute }
}

/** Vilken sida (och inställningsflik) varje fil hör till, via importerna. */
function placeFiles(files, fileRoute) {
  const importsOf = new Map()
  const namesOf = new Map()
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const list = []
    for (const m of text.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))[^'"]*from\s+'([^']+)'/g)) {
      const target = resolveImport(f, m[3])
      if (!target) continue
      list.push(target)
      for (const n of (m[1] ?? m[2] ?? '').split(',')) {
        const name = n.trim().split(' as ').pop()
        if (name) namesOf.set(`${f}::${name}`, target)
      }
    }
    importsOf.set(f, list)
  }
  const place = new Map()
  const visit = (start, route, hash) => {
    const queue = [[start, 0]]
    while (queue.length) {
      const [f, d] = queue.shift()
      const had = place.get(f)
      if (had && had.depth <= d && !(hash && !had.hash && had.route === route)) continue
      place.set(f, { route, hash, depth: d })
      for (const t of importsOf.get(f) ?? []) if (!fileRoute.has(t) && !t.includes('/shared/') ) queue.push([t, d + 1])
      for (const t of importsOf.get(f) ?? []) if (t.includes('/shared/') && !place.has(t)) queue.push([t, d + 1])
    }
  }
  for (const [file, route] of fileRoute) visit(file, route, null)
  // Inställningarnas flikar: <div data-help="settings:<flik>:<Komponent>">.
  const settingsFile = [...fileRoute].find(([, r]) => r === '/installningar')?.[0]
  const tabOf = new Map()
  if (settingsFile) {
    const text = readFileSync(settingsFile, 'utf8')
    for (const m of text.matchAll(/data-help="settings:(\w+):(\w+)"/g)) {
      const target = namesOf.get(`${settingsFile}::${m[2]}`)
      if (target) {
        tabOf.set(target, m[1])
        visit(target, '/installningar', m[1])
      }
    }
  }
  return { place, tabOf }
}

function extract(text) {
  const out = []
  const add = (kind, value, at, extra = {}) => {
    const t = clean(value)
    if (usable(t)) out.push({ kind, text: t, at, ...extra })
  }
  for (const m of text.matchAll(/<AdminTopbar[^>]*?title="([^"]+)"(?:[^>]*?subtitle="([^"]+)")?/g)) {
    add('page', m[1], m.index, { desc: m[2] })
  }
  for (const m of text.matchAll(/<h[1-4][^>]*>\s*([^<>{}]+?)\s*<\/h[1-4]>/g)) add('heading', m[1], m.index)
  for (const m of text.matchAll(/className="(?:appearance-title|form-section-label|settings-tab-title|settings-group-name)"[^>]*>\s*([^<>{}]+?)\s*</g)) add('heading', m[1], m.index)
  for (const m of text.matchAll(/<label[^>]*>\s*([^<>{}]+?)\s*</g)) add('field', m[1], m.index)
  for (const m of text.matchAll(/<button[^>]*>\s*(?:<Icon[^>]*\/>\s*)?([^<>{}]+?)\s*(?:<Icon[^>]*\/>\s*)?<\/button>/g)) add('button', m[1], m.index)
  for (const m of text.matchAll(/<CtaButton[^>]*?label="([^"]+)"/g)) add('button', m[1], m.index)
  for (const m of text.matchAll(/<(Tile|StatTile)\b[^>]*?label="([^"]+)"/g)) add('kpi', m[2], m.index, { help: `kpi:${helpSlug(m[2])}` })
  for (const m of text.matchAll(/<Card\b[^>]*?label="([^"]+)"/g)) add('card', m[1], m.index, { help: `card:${helpSlug(m[1])}` })
  for (const m of text.matchAll(/data-help="([^"]+)"/g)) out.push({ kind: 'anchor', text: '', at: m.index, help: m[1] })
  return out
}

function descriptions(text) {
  const out = []
  for (const m of text.matchAll(/className="(?:cell-muted|sk-insight|form-hint|card-sub)"[^>]*>\s*([^<>{}]+?)\s*</g)) out.push({ at: m.index, text: clean(m[1]) })
  for (const m of text.matchAll(/\binfo="([^"]+)"/g)) out.push({ at: m.index, text: clean(m[1]) })
  for (const m of text.matchAll(/<InfoTooltip[^>]*>\s*([^<>{}]+?)\s*<\/InfoTooltip>/g)) out.push({ at: m.index, text: clean(m[1]) })
  // Villkorad text: {villkor ? 'A' : 'B'} direkt i stycket, den första gäller.
  for (const m of text.matchAll(/className="cell-muted"[^>]*>\s*\{[^}]*?'([^']{12,300})'/g)) out.push({ at: m.index, text: clean(m[1]) })
  out.sort((a, b) => a.at - b.at)
  return out.filter((d) => d.text.length >= 8 && d.text.length <= 400 && /[a-zåäö]/i.test(d.text) && !SENSITIVE.test(d.text) && !/=>|\$\{|;|=\{/.test(d.text))
}

function hints(text) {
  // TAB_HINT och liknande: korta svenska förklaringar i objekt.
  return Object.fromEntries([...text.matchAll(/^\s*(\w+): '([^']{12,200})',?$/gm)].map((m) => [m[1], clean(m[2])]))
}

/**
 * Inställningarnas flikar ur InstallningarPage.tsx: namn (TAB_LABEL), en rad
 * om vad som finns där (TAB_HINT) och gruppen fliken ligger i (GROUPS), så som
 * menyn visar dem: först gruppen (Verksamheten), sedan fliken (Restaurang).
 */
export function settingsSections() {
  const text = readFileSync(join(SRC, 'features/installningar/InstallningarPage.tsx'), 'utf8')
  const block = (name) => {
    const start = text.indexOf(`const ${name}`)
    if (start < 0) throw new Error(`InstallningarPage.tsx: hittar inte ${name}`)
    return text.slice(start, text.indexOf('\n}', start) + 2)
  }
  const tabLabel = Object.fromEntries([...block('TAB_LABEL').matchAll(/^\s{2}(\w+): '([^']+)',$/gm)].map((m) => [m[1], m[2]]))
  const tabHint = hints(block('TAB_HINT'))
  const groups = text.slice(text.indexOf('const GROUPS'), text.indexOf('\n]', text.indexOf('const GROUPS')))
  const groupOf = {}
  for (const m of groups.matchAll(/label: '([^']+)'[^\n]*?tabs: \[([^\]]*)\]/g)) {
    for (const t of m[2].matchAll(/'(\w+)'/g)) groupOf[t[1]] = m[1]
  }
  for (const tab of Object.keys(tabLabel)) {
    if (!groupOf[tab]) throw new Error(`InstallningarPage.tsx: fliken ${tab} ligger inte i någon grupp (GROUPS)`)
  }
  return { tabLabel, tabHint, groupOf }
}

export function buildCorpus() {
  const files = walk(SRC).filter((f) => !SKIP_DIRS.some((d) => relative(SRC, f).startsWith(d)))
  const nav = parseNav()
  const { routes, fileRoute } = parseRoutes()
  const { place } = placeFiles(files, fileRoute)
  const pageInfo = (route) => {
    const item = nav.find((n) => (n.to === '/' ? route === '/' : route === n.to || route.startsWith(`${n.to}/`)))
    if (item) return item
    const extra = EXTRA_PAGES[route]
    return extra ? { to: route, label: extra.label, feature: extra.feature ?? null, ownerOnly: Boolean(extra.ownerOnly), insights: false } : null
  }
  const { tabLabel, tabHint, groupOf } = settingsSections()

  const docs = []
  const seen = new Set()
  const push = (doc) => {
    const key = `${doc.route}|${doc.hash ?? ''}|${doc.title.toLowerCase()}|${doc.kind}`
    if (seen.has(key)) return
    seen.add(key)
    docs.push(doc)
  }
  const access = (route, hash) => {
    const info = pageInfo(route) ?? { ownerOnly: false, feature: null, insights: false }
    const ownerOnly = info.ownerOnly || (route === '/installningar' && !SETTINGS_STAFF.includes(hash ?? ''))
    const feature = (hash && SETTINGS_FEATURE[hash]) || info.feature || null
    return { audience: ownerOnly ? 'owner' : 'all', ...(feature ? { feature } : {}), ...(info.insights ? { insights: true } : {}) }
  }
  const where = (route, hash) => {
    const page = pageInfo(route)?.label ?? route
    return hash && tabLabel[hash] ? `${page}, ${groupOf[hash]}, ${tabLabel[hash]}` : page
  }

  // Menyvalen och inställningsflikarna. Två menyval kan leda till samma ställe
  // (Ladda ner appen på datorn, Installera appen på mobilen): id:t får då valets tour.
  const navIds = new Set()
  for (const item of nav) {
    const [route, hash] = item.to.split('#')
    let navId = `nav${item.to === '/' ? ':oversikt' : item.to.replace(/[/#]/g, ':')}`
    if (navIds.has(navId)) navId = `${navId}:${item.tour ?? navIds.size}`
    navIds.add(navId)
    push({
      id: navId,
      kind: 'page', route, ...(hash ? { hash } : {}), title: item.label, where: 'vänstermenyn',
      text: `${item.label} finns i vänstermenyn.`,
      highlight: [`help:nav:${item.to}`],
      ...access(route, hash ?? null),
    })
  }
  for (const [tab, label] of Object.entries(tabLabel)) {
    push({
      id: `settings:${tab}`, kind: 'page', route: '/installningar', hash: tab, title: label,
      where: `Inställningar, ${groupOf[tab]}, ${label}`,
      text: `${label} finns under Inställningar, ${groupOf[tab]}.${tabHint[tab] ? ` ${tabHint[tab]}.` : ''}`,
      highlight: [`help:settings-tab:${tab}`],
      ...access('/installningar', tab),
    })
  }

  // Allt som syns i koden, per fil och plats.
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    const at = place.get(file)
    if (!at) continue
    const text = readFileSync(file, 'utf8')
    const items = extract(text).sort((a, b) => a.at - b.at)
    const descs = descriptions(text)
    const rel = relative(SRC, file)
    for (const [i, it] of items.entries()) {
      if (it.kind === 'anchor') continue
      const next = items[i + 1]?.at ?? Infinity
      const desc = it.desc ?? descs.find((d) => d.at > it.at && d.at < Math.min(it.at + 700, next + 400))?.text
      const anchor = it.help ?? [...items].reverse().find((a) => a.kind === 'anchor' && a.at < it.at && it.at - a.at < 300)?.help
      const route = at.route
      // I själva inställningssidan: fliken från närmaste data-help="settings:<flik>:..." före.
      const section = at.route === '/installningar' && !at.hash
        ? [...items].reverse().find((a) => a.kind === 'anchor' && a.at < it.at && a.help.startsWith('settings:'))?.help.split(':')[1]
        : undefined
      const hash = at.hash ?? section ?? undefined
      push({
        id: `${rel.replace(/\.tsx$/, '').replace(/[^a-zA-Z0-9]+/g, '-')}:${helpSlug(it.text)}:${it.kind}`,
        kind: it.kind === 'page' ? 'page' : 'element',
        route, ...(hash ? { hash } : {}),
        // "+ Lägg till rätt" heter Lägg till rätt; lysa upp gör den synliga texten.
        title: it.text.replace(/^[+\u2192\u2190]\s*/, ''),
        where: where(route, hash),
        text: desc ?? '',
        highlight: [anchor ? `help:${anchor}` : `text:${it.text}`],
        ...access(route, hash),
      })
    }
  }

  // Kurerade guider (steg för steg, sidhandlingar, levande siffror).
  const kb = JSON.parse(readFileSync(join(SRC, 'features/help/helpKb.json'), 'utf8'))
  const guides = kb.entries.map((e) => ({ ...e, kind: 'guide' }))
  return { version: 2, app: 'admin', routes, docs: [...guides, ...docs] }
}

/**
 * Vite-plugin för bygget: lägger kunskapsbasen bredvid appen under ett namn
 * med innehållets hash (help-corpus.<hash>.json, får cachas för alltid) och
 * skriver namnet i index.html (<meta name="booqy-help-corpus">), som aldrig
 * cachas. Servern läser index.html och hämtar sedan rätt fil, så den ser
 * alltid det som är driftsatt.
 */
export function helpCorpusPlugin() {
  let json = ''
  let file = ''
  return {
    name: 'booqy-help-corpus',
    apply: 'build',
    buildStart() {
      json = `${JSON.stringify(buildCorpus())}\n`
      file = `help-corpus.${createHash('sha256').update(json).digest('hex').slice(0, 10)}.json`
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'booqy-help-corpus', content: file }, injectTo: 'head' }]
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: file, source: json })
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const corpus = buildCorpus()
  const json = `${JSON.stringify(corpus)}\n`
  if (process.argv.includes('--stdout')) process.stdout.write(json)
  else {
    mkdirSync(join(ROOT, 'public'), { recursive: true })
    writeFileSync(join(ROOT, 'public/help-corpus.json'), json)
    console.log(`help-corpus.json: ${corpus.docs.length} delar`)
  }
}
