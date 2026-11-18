import { KB } from '../help/kb'
import type { HelpEntry } from '../help/kb'
import type { HelpContext } from '../help/chatState'
import type { Step } from '../phone-agent/setup'
import type { SetupStep } from './overview'

/**
 * Kom igång och Fråga Booqy delar en källa: hjälptexterna i helpKb.json som
 * har `setup` satt till stegets id (eller "phone:<delsteg>"). Därifrån tar
 * checklistan de föreslagna frågorna, och assistenten (här och på servern)
 * svarar ur samma texter. setupHelp.test.ts larmar när ett steg saknar text.
 */

export type SetupKey = SetupStep['id'] | `phone:${Step}`

/** Stegets hjälptexter, den med föreslagna frågor först. */
export function setupEntries(key: SetupKey): HelpEntry[] {
  return KB.entries
    .filter((e) => e.setup === key)
    .sort((a, b) => Number(Boolean(b.questions?.length)) - Number(Boolean(a.questions?.length)))
}

/** Det assistenten får med sig när man trycker ? vid ett steg eller delsteg. */
export function setupContext(key: SetupKey, label: string): HelpContext {
  const main = setupEntries(key)[0]
  return { key, label, questions: main?.questions ?? [`Hur blir ${label} klart?`] }
}
