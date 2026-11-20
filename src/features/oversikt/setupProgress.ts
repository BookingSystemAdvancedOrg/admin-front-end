/**
 * Vad som blivit klart i Kom igång sedan ägaren senast såg listan (i den
 * här fliken; inget sparas). Första gången en plats visas finns inget att
 * jämföra med, så då är inget nytt. Samma lista igen inom en sekund (React
 * kör om i utveckling) ger samma svar; senare (nästa besök) är den inte ny
 * längre, så ögonblicket visas bara en gång per ändring. Anropas i useMemo.
 */
export interface SetupProgress {
  /** Steg som blivit klara sedan förra gången. */
  fresh: string[]
  /** Allt blev klart nu (det var inte det förra gången). */
  finished: boolean
}

const NOTHING: SetupProgress = { fresh: [], finished: false }

/** Inom så lång tid räknas samma lista som samma anrop. */
const SAME_CALL_MS = 1000

interface Seen {
  at: number
  sig: string
  done: Set<string>
  complete: boolean
  result: SetupProgress
}

const seen = new Map<string, Seen>()

export function setupProgress(key: string, steps: readonly { id: string; state: string | null }[], now = Date.now()): SetupProgress {
  if (steps.length === 0) return NOTHING
  const doneIds = steps.filter((s) => s.state === 'done').map((s) => s.id)
  const complete = steps.every((s) => s.state === 'done' || s.state === 'skipped')
  const sig = `${doneIds.join(',')}|${complete}`
  const before = seen.get(key)
  if (before && before.sig === sig) return now - before.at < SAME_CALL_MS ? before.result : NOTHING
  const result: SetupProgress = before
    ? { fresh: doneIds.filter((id) => !before.done.has(id)), finished: complete && !before.complete }
    : NOTHING
  seen.set(key, { at: now, sig, done: new Set(doneIds), complete, result })
  return result
}

/** Bara för tester. */
export function resetSetupProgress() {
  seen.clear()
}
