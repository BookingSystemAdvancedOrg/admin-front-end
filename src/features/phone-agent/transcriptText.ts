import { langLabel, type Turn } from './api'

/** Utskriftens språkval: originalet eller översatt till svenska eller engelska. */
export type TextView = 'original' | 'sv' | 'en'
export const VIEWS: { key: TextView; label: string }[] = [
  { key: 'original', label: 'Original' },
  { key: 'sv', label: 'Svenska' },
  { key: 'en', label: 'English' },
]
export const isView = (v: unknown): v is TextView => VIEWS.some((x) => x.key === v)

export function readView(key: string): TextView {
  try {
    const v = localStorage.getItem(key)
    return isView(v) ? v : 'sv'
  } catch {
    return 'sv'
  }
}

/** "Arabiska" för "ar". */
export function langChip(code: string): string {
  const name = langLabel(code)
  return name.charAt(0).toLocaleUpperCase('sv') + name.slice(1)
}

/** Texten som visas: översättningen när den finns, annars originalet. */
export function shownText(t: Turn, view: TextView): string {
  if (view === 'sv') return t.textSv ?? t.text
  if (view === 'en') return t.textEn ?? t.text
  return t.text
}

/**
 * Så länge efter samtalets slut väntar sidan på översättningen (Lambdas egna
 * omförsök tar några minuter); sedan räknas den som misslyckad.
 */
export const TRANSLATE_WAIT_MS = 10 * 60_000

/**
 * Översättningens läge för sidan: `pending` bara när samtalet är slut (under
 * samtalet är turerna "pending" men inget översätts än), `failed` när en tur
 * misslyckades eller väntan gått ut, annars `none`.
 */
export function translationState(
  turns: Turn[], call: { outcome: unknown; startedAt: string; durationSec: number }, now = Date.now(),
): 'none' | 'pending' | 'failed' {
  const shown = turns.filter((t) => t.role !== 'tool')
  if (shown.some((t) => t.translation === 'failed')) return 'failed'
  if (call.outcome == null || !shown.some((t) => t.translation === 'pending')) return 'none'
  const endedAt = Date.parse(call.startedAt) + call.durationSec * 1000
  return Number.isFinite(endedAt) && now > endedAt + TRANSLATE_WAIT_MS ? 'failed' : 'pending'
}
