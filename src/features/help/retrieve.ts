import { entryVisible, KB } from './kb'
import type { HelpAnswer, HelpEntry, HelpView } from './kb'

/**
 * Hittar hjälptexterna som passar en fråga. Exakt samma regler som servern
 * (application/shared/help_assistant.py): samma vikning, ord och poäng, så
 * att svaret utan API (mockdata) och serverns svar utan språkmodell är
 * samma. Båda testas mot helpKbCases.json.
 */

export const MIN_SCORE = 3
export const CANDIDATES = 4

const STOPWORDS = new Set(
  ('jag du vi ni man en ett och att det den de som hur var vad kan ska gor gora har hor till for pa i ' +
    'av med om fran nar dar min mitt mina er ert era sin sitt sina vill skulle mig dig oss ' +
    'nagon nagot inte ar blir bli finns the a an how do i').split(' '),
)

export const UNKNOWN_TEXT =
  'Det vet jag inte säkert, så jag gissar hellre inte. Försök fråga på ett annat sätt, till exempel med namnet på sidan, eller titta i Hjälp.'
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

/** Samma ord, eller en böjning av det (rätt, rätten, rätterna); inte ett längre sammansatt ord. */
function match(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 4 && long.length - short.length <= 4 && long.startsWith(short)
}

export function score(entry: HelpEntry, question: string): number {
  const folded = ` ${fold(question)} `
  const keywords = entry.keywords.map(fold)
  let total = 0
  for (const phrase of keywords) if (phrase.includes(' ') && folded.includes(` ${phrase} `)) total += 4
  const single = keywords.filter((k) => !k.includes(' '))
  const title = tokens(entry.title)
  for (const word of tokens(question)) {
    if (single.some((k) => match(word, k))) total += 3
    else if (title.some((t) => match(word, t))) total += 1
  }
  return total
}

function rank(question: string, entries: HelpEntry[]): HelpEntry[] {
  return entries
    .map((e, i) => ({ e, i, s: score(e, question) }))
    .filter((x) => x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.e)
}

/** Träffar som användaren får se, bäst först, och om en ägartext träffade i stället. */
export function candidates(question: string, view: HelpView): { found: HelpEntry[]; ownerHit: boolean } {
  const mine = KB.entries.filter((e) => entryVisible(e, view))
  const found = rank(question, mine).slice(0, CANDIDATES)
  let ownerHit = false
  if (found.length === 0 && view.role !== 'owner_user') {
    const others = KB.entries.filter((e) => e.audience === 'owner' && entryVisible({ ...e, audience: 'all' }, view))
    ownerHit = rank(question, others).length > 0
  }
  return { found, ownerHit }
}

export function kbAnswer(entry: HelpEntry): HelpAnswer {
  return {
    known: true,
    text: entry.answer,
    steps: entry.steps.slice(0, 8),
    actions: (entry.actions ?? []).slice(0, 2),
    sources: [entry.id],
  }
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

/** Svaret utan språkmodell: den bästa hjälptexten, med förra frågan som stöd för följdfrågor. */
export function answerLocally(question: string, view: HelpView, previousQuestion = ''): HelpAnswer {
  let { found, ownerHit } = candidates(question, view)
  if (found.length === 0 && previousQuestion) ({ found, ownerHit } = candidates(`${previousQuestion} ${question}`, view))
  return found.length ? kbAnswer(found[0]) : unknownAnswer(ownerHit)
}
