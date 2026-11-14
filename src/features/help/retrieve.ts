import { parseWhen, todayIn } from './dates'
import { entryVisible } from './kb'
import type { HelpAction, HelpAnswer, HelpCorpus, HelpDoc, HelpLive, HelpView } from './kb'

/**
 * Hittar delarna av kunskapsbasen som passar en fråga och bygger svaret
 * utan språkmodell. Exakt samma regler som servern
 * (application/shared/help_assistant.py): samma vikning, ord, BM25-poäng,
 * böjningar och sammansättningar, och samma svar. Båda testas mot samma
 * frågor (helpKbCases.json), så mockläget och servern säger samma sak.
 */

export const MIN_SCORE = 4
export const CANDIDATES = 6
const K1 = 1.2
const B = 0.75
const GUIDE_BOOST = 1.5
const PHRASE_BONUS = 3
const RELATED = 0.75
/** Minst så stor del av frågans ord ska finnas i svaret. */
const COVERAGE = 0.4
/** Är den bästa träffen en som användaren inte får se, och de synliga mycket svagare: svara inte med dem. */
const HIDDEN_LEAD = 1.5

const STOPWORDS = new Set(
  ('jag du vi ni man en ett och att det den de som hur var vad kan ska gor gora har hor till for pa i ' +
    'av med om fran nar dar min mitt mina er ert era sin sitt sina vill skulle mig dig oss ' +
    'nagon nagot inte ar blir bli finns hade the a an how do i ' +
    'hitta hittar ser se visa vart vilken vilka where is what can my our ' +
    // Vanliga verb säger inget om var något finns (ändra, byta, ställa in ...).
    'andra andrar byt byta byter stall stalla staller satt satta satter gor gora lagg lagga lagger ' +
    'skapa skapar ta tar oppna oppnar fixa fixar anvanda anvander fa far koppla kopplar ladda laddar ' +
    'ner upp ut av').split(' '),
)

export const UNKNOWN_TEXT =
  'Det vet jag inte säkert, så jag gissar hellre inte. Försök fråga på ett annat sätt, till exempel med namnet på sidan, eller titta i Hjälp.'
export const REFUSE_TEXT =
  'Lösenord, nycklar, koder och andra restaurangers uppgifter kan jag inte visa eller ta fram. Fråga gärna hur något fungerar i Booqy i stället.'
export const OWNER_TEXT =
  'Det sköter restaurangens ägare. Fråga ägaren, så kan de göra det eller ge dig tillgång till det som behövs.'

/** Gemener, utan accenter, bara bokstäver och siffror. */
export function fold(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function tokens(text: string): string[] {
  return fold(text)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** 1 samma ord, 0,7 en böjning (rätt, rätten; koden, koder), 0,5 en del av ett sammansatt ord (bakgrund, bakgrundsfärgen). */
export function matchWeight(q: string, d: string): number {
  if (q === d) return 1
  const [short, long] = q.length <= d.length ? [q, d] : [d, q]
  const p = commonPrefix(short, long)
  if (short.length >= 4 && long.length - short.length <= 4 && p >= 4 && p >= short.length - 2) return 0.7
  if (short.length >= 4 && long.startsWith(short)) return 0.5
  return 0
}

type Index = { docs: HelpDoc[]; tf: Map<string, number>[]; head: Set<string>[]; len: number[]; avg: number; df: Map<string, number>; phrases: string[][]; vocab: string[] }
const indexes = new WeakMap<HelpCorpus, Index>()

function index(corpus: HelpCorpus): Index {
  const hit = indexes.get(corpus)
  if (hit) return hit
  const tf: Map<string, number>[] = []
  const head: Set<string>[] = []
  const len: number[] = []
  const df = new Map<string, number>()
  const phrases: string[][] = []
  for (const doc of corpus.docs) {
    const m = new Map<string, number>()
    const add = (text: string | undefined, w: number) => {
      for (const t of tokens(text ?? '')) m.set(t, (m.get(t) ?? 0) + w)
    }
    add(doc.title, 3)
    for (const k of doc.keywords ?? []) add(k, 3)
    add(doc.where, 1)
    // Rubriken och nyckelorden: minst ett av frågans ord ska träffa här.
    head.push(new Set(m.keys()))
    add(doc.text, 1)
    add(doc.answer, 1)
    tf.push(m)
    len.push([...m.values()].reduce((a, b) => a + b, 0))
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    phrases.push((doc.keywords ?? []).map(fold).filter((k) => k.includes(' ')))
  }
  const avg = len.reduce((a, b) => a + b, 0) / Math.max(len.length, 1)
  const vocab = [...df.keys()].filter((t) => t.length >= 4).sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  const built = { docs: corpus.docs, tf, head, len, avg, df, phrases, vocab }
  indexes.set(corpus, built)
  return built
}

function idf(ix: Index, term: string): number {
  const n = ix.df.get(term) ?? 0
  return Math.log(1 + (ix.docs.length - n + 0.5) / (n + 0.5))
}

/** Frågans ord, med sammansatta ord delade vid ett känt ord (bakgrundsfärgen: bakgrund, fargen). */
function queryTokens(ix: Index, question: string): string[] {
  const out: string[] = []
  for (const q of tokens(question)) {
    out.push(q)
    if (q.length < 8 || ix.df.has(q)) continue
    const head = ix.vocab.find((d) => q.length - d.length >= 3 && q.startsWith(d))
    if (!head) continue
    const rest = q.slice(head.length).replace(/^s(?=[^aeiouy])/, '')
    out.splice(out.length - 1, 1, head, ...(rest.length >= 3 ? [rest] : []))
  }
  return out
}

/** Poängen och hur många av frågans ord som finns i dokumentet. */
export function score(ix: Index, i: number, question: string, qs = queryTokens(ix, question)): { score: number; covered: number; head: boolean } {
  const tf = ix.tf[i]
  const norm = K1 * (1 - B + (B * ix.len[i]) / ix.avg)
  let total = 0
  let covered = 0
  let inHead = false
  for (const q of qs) {
    let best = 0
    for (const [d, f] of tf) {
      const w = matchWeight(q, d)
      if (w === 0) continue
      const s = (w * idf(ix, d) * f * (K1 + 1)) / (f + norm)
      if (s > best) best = s
    }
    if (best > 0) covered += 1
    if (!inHead) for (const d of ix.head[i]) if (matchWeight(q, d) > 0) inHead = true
    total += best
  }
  const folded = ` ${fold(question)} `
  for (const p of ix.phrases[i]) if (folded.includes(` ${p} `)) total += PHRASE_BONUS
  return { score: ix.docs[i].kind === 'guide' ? total * GUIDE_BOOST : total, covered, head: inHead }
}

function rank(corpus: HelpCorpus, question: string, keep: (d: HelpDoc) => boolean): { doc: HelpDoc; score: number }[] {
  const ix = index(corpus)
  const out: { doc: HelpDoc; score: number; i: number }[] = []
  const qs = queryTokens(ix, question)
  const need = Math.max(1, Math.ceil(qs.length * COVERAGE))
  ix.docs.forEach((doc, i) => {
    if (!keep(doc)) return
    const { score: s, covered, head } = score(ix, i, question, qs)
    if (s >= MIN_SCORE && covered >= need && head) out.push({ doc, score: s, i })
  })
  out.sort((a, b) => b.score - a.score || a.i - b.i)
  return out.map(({ doc, score: s }) => ({ doc, score: s }))
}

/** Träffar som användaren får se, bäst först, och om en ägartext träffade i stället. */
export function candidates(corpus: HelpCorpus, question: string, view: HelpView): { found: { doc: HelpDoc; score: number }[]; ownerHit: boolean } {
  const all = rank(corpus, question, () => true)
  const found = all.filter((f) => entryVisible(f.doc, view)).slice(0, CANDIDATES)
  const top = all[0]
  // Frågan gäller något som användaren inte får se (ägarens, eller inte i planen).
  if (top && !entryVisible(top.doc, view) && (found.length === 0 || top.score >= found[0].score * HIDDEN_LEAD)) {
    const ownerHit = view.role !== 'owner_user' && top.doc.audience === 'owner' && entryVisible({ ...top.doc, audience: 'all' }, view)
    return { found: [], ownerHit }
  }
  return { found, ownerHit: false }
}

const navigable = (doc: HelpDoc) => Boolean(doc.route) && !doc.route!.includes(':')

/** Knappen till dokumentets plats; guider har egna knappar. */
export function docActions(doc: HelpDoc): HelpAction[] {
  if (doc.kind === 'guide') return (doc.actions ?? []).map((a) => (a.highlight || !doc.highlight ? a : { ...a, highlight: doc.highlight }))
  if (!navigable(doc)) return []
  return [{
    id: `go:${doc.id}`,
    label: doc.kind === 'page' ? `Öppna ${doc.title}` : `Visa ${doc.title}`,
    to: doc.route!,
    ...(doc.hash ? { hash: doc.hash } : {}),
    ...(doc.highlight ? { highlight: doc.highlight } : {}),
  }]
}

/** Ber frågan om en hemlighet eller om andra restauranger? Då svarar assistenten nej. */
export function isSecretQuestion(question: string): boolean {
  const q = ` ${fold(question)} `
  const secret = / (losenord\w*|password|api ?nyckel\w*|nyckel\w*|nycklar\w*|token\w*|hemlig\w*|secret\w*|pin ?kod\w*|kortnummer\w*|personnummer\w*) /
  const show = / (vad ar|vilket ar|vilken ar|visa|ge mig|skicka|beratta|lista|kopiera|what is|show) /
  return (secret.test(q) && show.test(q)) || / andra (restauranger|restaurangers|kunder|kunders|foretag) /.test(q)
}

/** "Var ser jag ..." vill ha platsen, inte siffran. */
export function isWhereQuestion(question: string): boolean {
  const q = ` ${fold(question)} `
  return /^ (var|vart|where) /.test(q) || / var (ser|hittar|finns|star|kan) /.test(q)
}

/**
 * Den levande siffran för frågan. En annan dag eller period ("imorgon", "på
 * fredag", "nästa vecka", "20 november") ger måttet utan period med datumen
 * och delens rangeText; null när delen saknar text för andra dagar, så att
 * en siffra för fel dag aldrig visas. Samma regel som servern (live_for).
 */
export function liveFor(live: HelpLive, question: string, today = todayIn()): HelpLive | null {
  const when = parseWhen(question, today)
  if (!when) return live
  const metric = live.metric.replace(/(Today|Week|Month)$/, '')
  if (!live.rangeText || metric === live.metric) return null
  const label = when.label.charAt(0).toUpperCase() + when.label.slice(1)
  return { metric, text: live.rangeText.replace('{period}', label), range: { from: when.from, to: when.to } }
}

/** Svaret utan språkmodell: den bästa delen, och fler ställen på samma sida lyses upp samtidigt. */
export function composeAnswer(found: { doc: HelpDoc; score: number }[], question = '', today = todayIn()): HelpAnswer {
  const [{ doc, score: top }] = found
  const actions = docActions(doc).slice(0, 2)
  if (actions[0]) {
    // Fler ställen på samma sida (samma flik) som passar nästan lika bra lyses upp samtidigt.
    const elements = found.filter((f) => f.doc.kind !== 'guide')
    const best = doc.kind === 'guide' ? top / GUIDE_BOOST : top
    const extra = elements
      .filter((f) => f.doc !== doc && f.score >= best * RELATED && f.doc.route === actions[0].to && (f.doc.hash ?? '') === (actions[0].hash ?? ''))
      .flatMap((f) => f.doc.highlight ?? [])
    if (extra.length) actions[0] = { ...actions[0], highlight: [...new Set([...(actions[0].highlight ?? []), ...extra])] }
  }
  const text =
    doc.kind === 'guide'
      ? (doc.answer ?? '')
      : doc.kind === 'page'
        ? (doc.text ?? doc.title)
        : `${doc.title} finns under ${doc.where ?? 'Booqy'}.${doc.text ? ` ${doc.text}` : ''}`
  const live = doc.live && !isWhereQuestion(question) ? liveFor(doc.live, question, today) : null
  return {
    known: true,
    text,
    steps: (doc.steps ?? []).slice(0, 8),
    actions,
    sources: [doc.id],
    ...(live ? { live } : {}),
  }
}

export function refusal(): HelpAnswer {
  return { known: false, text: REFUSE_TEXT, steps: [], actions: [], sources: [] }
}

export function unknownAnswer(ownerOnly = false): HelpAnswer {
  return {
    known: false,
    text: ownerOnly ? OWNER_TEXT : UNKNOWN_TEXT,
    steps: [],
    actions: ownerOnly ? [] : [{ id: 'hjalp', label: 'Öppna Hjälp', to: '/hjalp' }],
    sources: [],
  }
}

/** Nämner frågan det delen räknar ("bokningar", "gäster"), inte bara dagen? */
function about(doc: HelpDoc, asked: string): boolean {
  const head = new Set(tokens([doc.title, ...(doc.keywords ?? [])].join(' ')))
  return tokens(asked).some((q) => q !== 'idag' && [...head].some((d) => matchWeight(q, d) > 0))
}

/** Svaret utan språkmodell, med förra frågan som stöd för följdfrågor. */
export function answerLocally(corpus: HelpCorpus, question: string, view: HelpView, previousQuestion = '', today = todayIn()): HelpAnswer {
  if (isSecretQuestion(question)) return refusal()
  // En kort följdfråga ("Och hur länge?", "Och imorgon?") läses ihop med förra frågan.
  const short = Boolean(previousQuestion) && tokens(question).length <= 2
  const lookup = (asked: string) => {
    let hit = candidates(corpus, short ? `${previousQuestion} ${asked}` : asked, view)
    if (hit.found.length === 0 && previousQuestion) hit = candidates(corpus, short ? asked : `${previousQuestion} ${asked}`, view)
    return hit
  }
  // En annan dag ("imorgon", "på fredag") söks som idag när det ger en levande
  // siffra (composeAnswer sätter dagen); andra frågor läses som de är.
  const when = parseWhen(question, today)
  const day = when ? lookup(when.query) : { found: [], ownerHit: false }
  let { found, ownerHit } = day
  if (!found[0]?.doc.live || !about(found[0].doc, short ? `${previousQuestion} ${when?.query}` : (when?.query ?? ''))) {
    ;({ found, ownerHit } = lookup(question))
    ownerHit = ownerHit || (found.length === 0 && day.ownerHit)
  }
  return found.length ? composeAnswer(found, question, today) : unknownAnswer(ownerHit)
}
