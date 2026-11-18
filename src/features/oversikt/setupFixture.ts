import type { ServerSetupStep, SetupChecklist, SetupState } from './setupApi'

/**
 * Testdata: GET /tenant/setup som servern svarar (application
 * functions/tenant-setup). Bara för testerna.
 */
const ALL: [string, string, 'tenant' | 'location', boolean][] = [
  ['dpa', 'Godkänn personuppgiftsbiträdesavtalet', 'tenant', false],
  ['hours', 'Lägg in öppettider', 'location', true],
  ['menu', 'Lägg upp menyn', 'location', true],
  ['printers', 'Kvittoskrivare', 'location', true],
  ['layout', 'Publicera och aktivera en bordslayout', 'location', true],
  ['stripe', 'Slutför Stripe för kortbetalningar', 'tenant', true],
  ['staff', 'Bjud in personal', 'tenant', true],
  ['google', 'Google-profil (valfritt)', 'location', true],
  ['phone', 'Telefonassistent', 'location', true],
]

export const PHONE_SUB = ['namn', 'tider', 'nummer', 'koppla', 'prova']

export function serverChecklist(
  state: Record<string, SetupState> = {},
  { locationId = 'loc-1', skippedHere = [] as string[], unknown = [] as string[] } = {},
): SetupChecklist {
  const steps: ServerSetupStep[] = ALL.map(([id, label, scope, skippable]) => {
    const s = state[id] ?? 'open'
    const known = !unknown.includes(id)
    const here = skippedHere.includes(id)
    if (scope === 'tenant') return { id, label, labelEn: id, scope, skippable, state: s, known, skippedHere: here }
    return {
      id, label, labelEn: id, scope, skippable, state: s, known,
      locations: [{
        locationId, name: 'Södermalm', state: s, known, skippedHere: here,
        ...(id === 'phone' ? { sub: PHONE_SUB.map((x) => ({ id: x, done: s === 'done' })) } : {}),
      }],
    }
  })
  const count = (x: SetupState) => steps.filter((s) => s.state === x).length
  return { complete: count('open') === 0, total: steps.length, done: count('done'), skipped: count('skipped'), open: count('open'), completedAt: null, steps }
}
