import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCorpus } from '../../../scripts/help-corpus.mjs'
import { FEATURE_KEYS } from '../../shared/contracts'
import { setCorpus } from '../help/corpus'
import { withContext } from '../help/chatState'
import { HelpChat } from '../help/HelpChat'
import { KB } from '../help/kb'
import type { HelpView } from '../help/kb'
import { answerLocally } from '../help/retrieve'
import { STEPS } from '../phone-agent/setup'
import { SETUP } from '../phone-agent/api'
import { stepsFromServer } from './overview'
import { serverChecklist } from './setupFixture'
import type { SetupStep } from './overview'
import { SetupStepItem } from './SetupStepItem'
import { setupContext, setupEntries } from './setupHelp'
import type { SetupKey } from './setupHelp'

/**
 * Kom igång och Fråga Booqy ur samma källa (helpKb.json, `setup`): varje steg
 * och delsteg har hjälptext med föreslagna frågor, frågorna besvaras ur
 * stegets egen text, och ? vid ett steg öppnar assistenten om det steget.
 */

// Alla steg checklistan kan visa. Ett nytt id i SetupStep['id'] utan rad här
// stoppar typkontrollen; raden kräver sedan hjälptext (testet nedan).
const ALL_STEPS: Record<SetupStep['id'], true> = {
  dpa: true, hours: true, menu: true, printers: true, layout: true, stripe: true, staff: true, google: true, phone: true,
}
const ALL_KEYS: SetupKey[] = [...(Object.keys(ALL_STEPS) as SetupStep['id'][]), ...STEPS.map((s) => `phone:${s}` as const)]

// Allt påslaget: varje steg servern kan skicka.
const everything = stepsFromServer(serverChecklist(), 'loc-1')
const owner: HelpView = { role: 'owner_user', features: Object.fromEntries(FEATURE_KEYS.map((f) => [f, true])), staffInsights: true }
const corpus = buildCorpus()

/** Etiketten som checklistan skickar med (setupContext). */
function labelOf(key: SetupKey): string {
  if (!key.startsWith('phone:')) return everything.find((s) => s.id === key)!.label
  const sub = key.slice(6) as (typeof STEPS)[number]
  return SETUP.STEP_LABEL[STEPS.indexOf(sub)]
}

describe('Kom igång help knowledge', () => {
  it('shows every step when everything is on, and the list matches the known steps', () => {
    expect(everything.map((s) => s.id).sort()).toEqual(Object.keys(ALL_STEPS).sort())
    expect(everything.find((s) => s.id === 'phone')?.sub?.map((s) => s.id)).toEqual(STEPS)
  })

  it.each(ALL_KEYS)('%s has help text with suggested questions', (key) => {
    const entries = setupEntries(key)
    expect(entries.length, `helpKb.json saknar en text med "setup": "${key}"`).toBeGreaterThan(0)
    const [main] = entries
    expect(main.questions?.length).toBeGreaterThan(0)
    expect(main.answer.length).toBeGreaterThan(40)
    expect(main.answer.length, 'servern läser högst 400 tecken').toBeLessThanOrEqual(400)
    expect(main.steps.length).toBeGreaterThan(1)
    expect(main.actions?.length).toBeGreaterThan(0)
    expect(main.audience).toBe('owner')
  })

  it('has no help text for a step that does not exist', () => {
    const orphans = KB.entries.filter((e) => e.setup && !ALL_KEYS.includes(e.setup as SetupKey)).map((e) => e.id)
    expect(orphans).toEqual([])
  })

  it('never uses en or em dashes in the step texts', () => {
    const text = JSON.stringify(KB.entries.filter((e) => e.setup))
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|&[nm]dash;`)
    expect(text).not.toMatch(dashes)
  })

  // Varje föreslagen fråga, så som den skickas från steget, besvaras ur stegets egen text.
  const asked = ALL_KEYS.flatMap((key) => (setupEntries(key)[0]?.questions ?? []).map((q) => [key, q] as const))
  it.each(asked)('%s: "%s" is answered from that step', (key, question) => {
    const a = answerLocally(corpus, withContext(question, { label: labelOf(key) }), owner)
    expect(a.known).toBe(true)
    const source = KB.entries.find((e) => e.id === a.sources[0])
    expect(source?.setup, `svaret kom från ${a.sources[0]}`).toBe(key)
  })

  it.each([
    ['printers', 'Skrivaren svarar inte', 'kom-igang-printers-fel'],
    ['phone:koppla', 'Jag hör ett felmeddelande när jag slår koden', 'kom-igang-phone-koppla'],
    ['phone:tider', 'Det står Lägg in öppettider först', 'kom-igang-phone-tider'],
    ['google', 'Google har inte verifierat appen', 'kom-igang-google'],
    ['layout', 'Röda bord står ovanpå varandra', 'kom-igang-layout'],
  ] as const)('%s: a typed follow-up "%s" stays on the step', (key, question, source) => {
    const a = answerLocally(corpus, withContext(question, { label: labelOf(key) }), owner)
    expect(a.sources[0]).toBe(source)
  })

  it('sends the step name with the question', () => {
    expect(withContext('Den skriver inte ut', { label: 'Kvittoskrivare' })).toBe('Kom igång, Kvittoskrivare: Den skriver inte ut')
    expect(withContext('Hej', null)).toBe('Hej')
  })
})

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({ tenant, status: 'ready', error: null, locationId: 'loc-1', refresh: async () => null }),
}))

describe('Fråga Booqy from a Kom igång step', () => {
  beforeAll(() => setCorpus(corpus))
  beforeEach(() => {
    tenant = {
      tenantId: 't1', name: 'Roma', role: 'owner_user',
      locations: [{ locationId: 'loc-1', name: 'Roma', address: null, timezone: 'Europe/Stockholm' }],
      entitlements: { maxLocations: null, features: Object.fromEntries(FEATURE_KEYS.map((f) => [f, true])) },
    }
  })

  function renderList(askOn = true) {
    return render(
      <MemoryRouter>
        <HelpChat />
        {everything.map((s) => <SetupStepItem key={s.id} step={s} askOn={askOn} />)}
      </MemoryRouter>,
    )
  }

  it('has an ask button on every row and every sub-step chip, and none when the assistant is off', () => {
    renderList()
    for (const step of everything) expect(screen.getByRole('button', { name: `Fråga Booqy om ${step.label}` })).toBeInTheDocument()
    for (const label of SETUP.STEP_LABEL) expect(screen.getByRole('button', { name: `Fråga Booqy om ${label}` })).toBeInTheDocument()
  })

  it('renders no ask buttons when the assistant is off, and the row still links to the step', () => {
    renderList(false)
    expect(screen.queryByRole('button', { name: /^Fråga Booqy om/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Kvittoskrivare/ })).toHaveAttribute('href', '/installningar#skrivare')
  })

  it('opens the assistant on the printer step, suggests its questions and answers from it', async () => {
    const user = userEvent.setup()
    renderList()
    // HelpChat slår på sig själv (utan API: kunskapsbasen i webbläsaren).
    await screen.findByRole('button', { name: 'Fråga Booqy' })
    await user.click(screen.getByRole('button', { name: 'Fråga Booqy om Kvittoskrivare' }))
    const panel = screen.getByRole('dialog', { name: 'Hjälpassistenten' })
    expect(within(panel).getByText('Kvittoskrivare')).toBeInTheDocument()
    const questions = setupContext('printers', 'Kvittoskrivare').questions
    for (const q of questions) expect(within(panel).getByRole('button', { name: q })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: questions[1] }))
    expect(await within(panel).findByText(/Står det Svarar inte/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Öppna Kvittoskrivare/ })).toBeInTheDocument()
  })

  it('opens on a phone sub-step and keeps the step for a typed question', async () => {
    const user = userEvent.setup()
    renderList()
    await screen.findByRole('button', { name: 'Fråga Booqy' })
    await user.click(screen.getByRole('button', { name: 'Fråga Booqy om Vidarekoppling' }))
    const panel = screen.getByRole('dialog', { name: 'Hjälpassistenten' })
    expect(within(panel).getByText('Vidarekoppling')).toBeInTheDocument()
    await user.type(within(panel).getByLabelText('Din fråga'), 'Koden fungerar inte{Enter}')
    expect(await within(panel).findByText(/Vidarekoppling är klart när/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Öppna Vidarekoppling/ })).toBeInTheDocument()
    // Sammanhanget går att ta bort.
    await user.click(within(panel).getByRole('button', { name: 'Sluta fråga om Vidarekoppling' }))
    expect(within(panel).queryByText('Vidarekoppling')).toBeNull()
  })
})
