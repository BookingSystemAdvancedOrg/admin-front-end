import { apiFetch } from '../../shared/api'

/**
 * Kom igång kommer från servern (application functions/tenant-setup): samma
 * regel för admin och Booqy Console. Varje steg är klart, överhoppat eller
 * kvar, för platssteg per plats. Regeln: application docs/SETUP-CHECKLIST.md.
 */

export type SetupState = 'done' | 'skipped' | 'open'

export interface SetupPlace {
  locationId: string
  name: string
  state: SetupState
  /** false = datan kunde inte läsas (räknas som kvar). */
  known: boolean
  /** Överhoppat med "Hoppa över" (stegets egna, som "Inga skrivare än", räknas inte hit). */
  skippedHere: boolean
  /** Telefonassistentens fem delsteg. */
  sub?: { id: string; done: boolean }[]
}

export interface ServerSetupStep {
  id: string
  label: string
  labelEn: string
  scope: 'tenant' | 'location'
  skippable: boolean
  state: SetupState
  known: boolean
  skippedHere?: boolean
  locations?: SetupPlace[]
}

export interface SetupChecklist {
  complete: boolean
  total: number
  done: number
  skipped: number
  open: number
  /** När allt först blev klart (står kvar om ett steg öppnas igen). */
  completedAt: string | null
  steps: ServerSetupStep[]
}

export const getSetup = () => apiFetch<SetupChecklist>('/tenant/setup')

/** "Hoppa över" (skipped = true) eller "Ångra" (false); svarar med hela listan. */
export const skipSetupStep = (step: string, locationId: string | undefined, skipped: boolean) =>
  apiFetch<SetupChecklist>('/tenant/setup/skips', {
    method: 'PUT',
    body: JSON.stringify({ step, skipped, ...(locationId ? { locationId } : {}) }),
  })
