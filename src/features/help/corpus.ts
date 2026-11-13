import type { HelpCorpus } from './kb'

/**
 * Kunskapsbasen som appen bygger ur sin egen kod (scripts/help-corpus.mjs,
 * public/help-corpus.json). Hämtas en gång när assistenten behöver den.
 */

let corpus: HelpCorpus | null = null
let loading: Promise<HelpCorpus> | null = null

export function setCorpus(next: HelpCorpus | null) {
  corpus = next
  loading = null
}

export function loadCorpus(): Promise<HelpCorpus> {
  if (corpus) return Promise.resolve(corpus)
  loading ??= fetch(`${import.meta.env.BASE_URL ?? '/'}help-corpus.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`help-corpus ${r.status}`)
      return r.json() as Promise<HelpCorpus>
    })
    .then((c) => (corpus = c))
    .finally(() => {
      loading = null
    })
  return loading
}
