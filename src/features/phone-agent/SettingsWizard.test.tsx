import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import type { BusinessHours } from '../installningar/locationApi'
import { formatPhone } from '../../shared/phone'
import SettingsWizard from './SettingsWizard'
import type { CallRow, Config, LocationConfig } from './api'
import { chooseOption } from '../../test/select'

vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant: { role: 'owner_user', locations: [{ locationId: 'loc-1', name: 'Bistro' }] }, locationId: 'loc-1' }),
}))
vi.mock('../../shared/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/api')>()),
  isApiConfigured: () => true,
  apiFetch: vi.fn(),
}))
const { apiFetch } = await import('../../shared/api')

const HOURS: BusinessHours = {
  monday: [{ opensAt: '11:00', closesAt: '22:00' }], tuesday: [{ opensAt: '11:00', closesAt: '22:00' }],
  wednesday: [{ opensAt: '11:00', closesAt: '22:00' }], thursday: [{ opensAt: '11:00', closesAt: '22:00' }],
  friday: [{ opensAt: '11:00', closesAt: '22:00' }], saturday: [], sunday: [],
}

/** En liten falsk server: samma vägar och svar som phone-agent (CONTRACTS.md 6.L). */
interface Server {
  config: Config
  loc: LocationConfig
  hours: BusinessHours | null
  phone: string | null
  calls: CallRow[]
  fail: Record<string, ApiError[]>
  requests: { method: string; path: string; body?: Record<string, unknown> }[]
}
let server: Server

const OFF = 'Stäng av gammal vidarekoppling'
function codesFor(l: LocationConfig): LocationConfig['forwarding'] {
  const n = l.simulated && l.testNumber ? l.testNumber : l.number
  const operator = l.setup?.operator ?? 'other'
  if (!n || operator === 'vaxel') return { number: n, operator, reset: [], codes: [] }
  if (operator === 'telia_fast') {
    // Som servern: en fast telefon har ingen +, så numret står nationellt.
    const desk = n.startsWith('+46') ? `0${n.slice(3)}` : `00${n.slice(1)}`
    return { number: n, operator, reset: ['#21#', '#61#', '#67#'].map((on) => ({ label: OFF, on })),
      codes: [{ label: 'Ej svar', on: `*61*${desk}#`, off: '#61#' }, { label: 'Upptaget', on: `*67*${desk}#`, off: '#67#' }] }
  }
  return { number: n, operator, reset: [{ label: OFF, on: '##002#' }],
    codes: [l.mode === 'always' ? { label: 'Alla', on: `**21*${n}#`, off: '##21#' } : { label: 'Ej svar', on: `**004*${n}#`, off: '##004#' }] }
}

/** Natt och morgon på måndagar: Tider är klart. */
const NIGHTS = { mon: [{ from: '00:00', to: '11:00' }, { from: '22:00', to: '23:59' }] }

function freshServer(over: Partial<Server> = {}): Server {
  const loc: LocationConfig = {
    locationId: 'loc-1', enabled: false, killSwitch: false, mode: 'after_hours', agentHours: {}, greetingExtraSv: '', greetingExtraEn: '',
    transferTo: null, maxCallSeconds: 480, counterOffers: { nearbyTables: true, phoneOnlyTables: true }, number: null, numberSharedWith: null,
    version: 0, setup: { operator: null, forwardedAt: null, testedAt: null }, simulated: false,
  }
  return {
    config: { agentName: 'Booqy', tone: 'friendly', languages: ['sv', 'en'], recording: { enabled: false }, minutesCapPerMonth: 300, version: 0 },
    loc: { ...loc, forwarding: codesFor(loc) }, hours: HOURS, phone: '+46812345678', calls: [], fail: {}, requests: [], ...over,
  }
}

function setLoc(patch: Partial<LocationConfig>) {
  const next = { ...server.loc, ...patch }
  server.loc = { ...next, forwarding: codesFor(next) }
}

async function handle(path: string, init: RequestInit = {}) {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  server.requests.push({ method, path, body })
  const key = `${method} ${path.split('?')[0]}`
  const failure = server.fail[key]?.shift()
  if (failure) throw failure
  const stale = () => { throw new ApiError(409, 'changed_retry', { code: 'changed_retry', fromServer: true }) }
  switch (key) {
    case 'GET /tenant/phone-agent':
      return { config: server.config, locations: [], usage: { minutes: 0, cap: 300, includedMinutes: 300, periodEnd: '2026-11-24' } }
    case 'PUT /tenant/phone-agent/config':
      if (body.version !== server.config.version) stale()
      server.config = { ...server.config, ...body, version: body.version + 1 }
      return server.config
    case 'GET /locations/loc-1/phone-agent':
      return server.loc
    case 'PUT /locations/loc-1/phone-agent': {
      if (body.version !== server.loc.version) stale()
      const { shareNumberWith: _s, ...rest } = body
      const before = codesFor(server.loc)?.codes.map((c) => c.on)
      setLoc({ ...rest, number: body.enabled ? (server.loc.number ?? '+46100000001') : server.loc.number, version: body.version + 1 })
      // Som servern: en annan kod betyder att vidarekopplingen måste göras om.
      if (server.loc.setup?.forwardedAt && JSON.stringify(before) !== JSON.stringify(server.loc.forwarding?.codes.map((c) => c.on))) {
        setLoc({ setup: { ...server.loc.setup, forwardedAt: null, testedAt: null } })
      }
      return server.loc
    }
    case 'POST /locations/loc-1/phone-agent/setup': {
      if (body.version !== server.loc.version) stale()
      const setup = { ...server.loc.setup! }
      if (body.operator) setup.operator = body.operator
      if (body.forwarded !== undefined) setup.forwardedAt = body.forwarded ? '2026-11-14T10:00:00Z' : null
      if (body.tested !== undefined) setup.testedAt = body.tested ? '2026-11-14T10:05:00Z' : null
      setLoc({ setup, version: body.version + 1 })
      return server.loc
    }
    case 'GET /locations/loc-1':
      return { locationId: 'loc-1', name: 'Bistro', businessHours: server.hours, phoneNumber: server.phone }
    case 'GET /locations/loc-1/phone-agent/calls':
      return { calls: server.calls, cursor: null }
    case 'POST /locations/loc-1/phone-agent/simulate':
      return { reply: 'Hej, jag kan hjälpa till.', language: 'sv', toolCalls: [], state: {}, disclosure: true }
  }
  throw new Error(`unexpected ${key}`)
}

const sent = (method: string, path: string) => server.requests.filter((r) => r.method === method && r.path.split('?')[0] === path)

function renderWizard() {
  const onSaved = vi.fn()
  render(<MemoryRouter><SettingsWizard locationId="loc-1" onSaved={onSaved} /></MemoryRouter>)
  return onSaved
}

/** En klar rad i checklistan: "Tider När ni har stängt, klart". */
const doneRow = (label: string) => (name: string) => name.startsWith(label) && name.endsWith(', klart')
const step = (n: number) => screen.findByText(`Steg ${n} av 5`)
const nextButton = () => screen.getByRole('button', { name: 'Nästa' })

beforeEach(() => {
  server = freshServer()
  vi.mocked(apiFetch).mockImplementation(((path: string, init?: RequestInit) => handle(path, init)) as typeof apiFetch)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => {
  vi.useRealTimers()
})

/** "Klart! Samtal till <restaurangens nummer> går till assistenten när ni har stängt." */
const doneText = (_: string, el: Element | null) => Boolean(el?.classList.contains('telefon-done')
  && /^ ?Klart! Samtal till .+ går till assistenten när ni har stängt\.$/.test(el.textContent ?? ''))

describe('checklist', () => {
  it('starts with Börja and every step open', async () => {
    renderWizard()
    expect(await screen.findByRole('heading', { name: 'Kom igång med telefonassistenten' })).toBeInTheDocument()
    for (const label of ['Namn', 'Tider', 'Booqy-nummer', 'Vidarekoppling', 'Provsamtal']) {
      expect(screen.getByRole('button', { name: new RegExp(`${label}, inte klart`) })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Börja' })).toBeInTheDocument()
  })

  it('continues at the first open step and shows the done values', async () => {
    server.config = { ...server.config, version: 1, agentName: 'Sara' }
    setLoc({ version: 3, enabled: true, number: '+46100000001', agentHours: NIGHTS })
    renderWizard()
    expect(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' })).toBeInTheDocument()
    expect(screen.getByText('Sara')).toBeInTheDocument()
    expect(screen.getByText('+46 10 000 00 01')).toBeInTheDocument()
  })

  it('shows the success bar and the off code when everything is done', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 5, enabled: true, number: '+46100000001', agentHours: NIGHTS,
      setup: { operator: 'telia', forwardedAt: '2026-11-14T10:00:00Z', testedAt: '2026-11-14T10:05:00Z' } })
    renderWizard()
    expect(await screen.findByText(doneText)).toBeInTheDocument()
    expect(screen.queryByText(/Klart! Assistenten svarar på/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Börja$|Fortsätt)/ })).not.toBeInTheDocument()
    expect(screen.getByText('##004#')).toBeInTheDocument()
    expect(screen.getByText('Fungerar')).toBeInTheDocument()
  })

  it('says it is our fault and retries when loading fails', async () => {
    server.fail['GET /tenant/phone-agent'] = [new ApiError(503, 'service_unavailable', { fromServer: true })]
    renderWizard()
    expect(await screen.findByRole('button', { name: 'Rapportera till Booqy' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByRole('button', { name: 'Börja' })).toBeInTheDocument()
  })
})

describe('wizard', () => {
  async function open() {
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Börja' }))
    await step(1)
  }

  it('prefills Booqy, refuses an empty name inline without saving, and never shows the browser tooltip', async () => {
    await open()
    const input = screen.getByLabelText('Namn') as HTMLInputElement
    expect(input.value).toBe('Booqy')
    expect(input.closest('form')).toHaveAttribute('novalidate')
    fireEvent.change(input, { target: { value: '  ' } })
    fireEvent.click(nextButton())
    expect(await screen.findByText('Skriv ett namn på assistenten, till exempel Booqy.')).toBeInTheDocument()
    expect(sent('PUT', '/tenant/phone-agent/config')).toHaveLength(0)
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('saves the name with the friendly tone and recording off, then shows step 2', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Namn'), { target: { value: 'Sara' } })
    expect(screen.getByText(/Hej, du pratar med Sara, en AI-assistent för Bistro/)).toBeInTheDocument()
    fireEvent.click(nextButton())
    await step(2)
    expect(sent('PUT', '/tenant/phone-agent/config')[0].body).toMatchObject({ agentName: 'Sara', tone: 'friendly', recording: { enabled: false }, version: 0 })
  })

  it('fetches the latest and retries once when someone else saved meanwhile', async () => {
    await open()
    server.config = { ...server.config, version: 4 }          // someone else saved
    fireEvent.click(nextButton())
    await step(2)
    const puts = sent('PUT', '/tenant/phone-agent/config')
    expect(puts.map((p) => p.body?.version)).toEqual([0, 4])
    expect(puts[1].body?.agentName).toBe('Booqy')
  })

  it('derives the hours from the opening hours for the chosen mode', async () => {
    server.config = { ...server.config, version: 1 }
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Tider' }))
    await step(2)
    expect(screen.getByLabelText('När ni har stängt')).toBeChecked()
    expect(screen.getByText('Mån-tor 22:00-11:00, fre 22:00-mån 11:00')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('När ni inte hinner svara'))
    expect(screen.getByText('Mån-fre 11:00-22:00')).toBeInTheDocument()
    fireEvent.click(nextButton())
    await step(3)
    const put = sent('PUT', '/locations/loc-1/phone-agent')[0].body!
    expect(put).toMatchObject({ enabled: false, mode: 'overflow', version: 0 })
    expect((put.agentHours as Record<string, unknown>).mon).toEqual([{ from: '11:00', to: '22:00' }])
  })

  it('without opening hours only Alltid can be chosen', async () => {
    server = freshServer({ hours: null, config: { ...freshServer().config, version: 1 } })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Tider' }))
    await step(2)
    expect(screen.getByLabelText('När ni har stängt')).toBeDisabled()
    expect(screen.getByLabelText('När ni inte hinner svara')).toBeDisabled()
    expect(screen.getByLabelText('Alltid')).toBeChecked()
    expect(screen.getByRole('link', { name: 'Öppna Inställningar' })).toHaveAttribute('href', '/installningar')
    fireEvent.click(nextButton())
    await step(3)
    expect(sent('PUT', '/locations/loc-1/phone-agent')[0].body).toMatchObject({ mode: 'always', agentHours: {} })
  })

  it('gets a number only on the button, and shows a Booqy fault with a retry', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 1, agentHours: NIGHTS })
    server.fail['PUT /locations/loc-1/phone-agent'] = [new ApiError(502, 'telephony_unavailable', { code: 'telephony_unavailable', fromServer: true })]
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Booqy-nummer' }))
    await step(3)
    expect(screen.queryByRole('button', { name: 'Nästa' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skaffa nummer' }))
    expect(await screen.findByText(/Telefonbolaget svarar inte just nu. Det är inte ert fel/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Försök igen' }))
    await step(4)
    expect(sent('PUT', '/locations/loc-1/phone-agent').at(-1)!.body).toMatchObject({ enabled: true })
  })

  it('walks the forwarding: operator cards, the off code, then the code in five numbered steps, then Klart', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' }))
    expect(await screen.findByRole('heading', { name: 'Vilken operatör har restaurangens telefon?' })).toBeInTheDocument()
    expect(screen.getByText(/Vet du inte\? Det står på fakturan/)).toBeInTheDocument()
    expect(screen.getByText('Till exempel Comviq, Hallon, Vimla eller Fello')).toBeInTheDocument()
    for (const op of ['Telia', 'Tele2', 'Telenor', 'Tre', 'Annan']) expect(screen.getByLabelText(op)).toBeInTheDocument()
    fireEvent.click(nextButton())
    expect(await screen.findByText('Välj er telefonoperatör i listan.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Telia'))
    fireEvent.click(nextButton())
    expect(await screen.findByText('Kod 1 av 2: Först: stäng av gammal vidarekoppling')).toBeInTheDocument()
    expect(screen.getByLabelText('Koden ##002#')).toBeInTheDocument()
    expect(screen.getByText(/Det gör inget: då fanns ingen gammal/)).toBeInTheDocument()
    expect(screen.getByText('Det här stänger av gammal vidarekoppling, om ni har någon.')).toBeInTheDocument()
    expect(screen.getByText('Telefonen visar ett meddelande. Det spelar ingen roll vad det står. Tryck på Nästa nedan.')).toBeInTheDocument()
    fireEvent.click(nextButton())
    expect(await screen.findByText(/Kod 2 av 2/)).toBeInTheDocument()
    const steps = [...screen.getAllByRole('list', { name: 'Så gör du' })[0].querySelectorAll(':scope > li')]
    expect(steps.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Ta fram restaurangens telefon'),
      expect.stringContaining('Öppna appen Telefon'),
      expect.stringContaining('Skriv in koden'),
      expect.stringContaining('Tryck på den gröna lur-knappen'),
      expect.stringContaining('Vänta tills telefonen visar'),
    ])
    // Koden i bitar, och bitarna ihop är exakt koden; # sitter ihop med sista biten.
    // På en dator skriver man av den: ingen fråga, ingen Ring-knapp, ingen Kopiera vid koden.
    const box = screen.getByLabelText('Koden **004*+46100000001#')
    expect(box.textContent).toBe('**004*+46100000001#')
    expect([...box.children].at(-1)!.textContent).toBe('01#')
    expect(screen.getAllByText('Skriv utan mellanrum.').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Har du öppnat den här sidan/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ring koden/ })).not.toBeInTheDocument()
    expect(within(box.closest('.telefon-codebox')!).queryByRole('button', { name: 'Kopiera' })).not.toBeInTheDocument()
    expect(screen.getByText(/håll fingret på/)).toBeInTheDocument()
    expect(screen.getByText('Samtal som ni inte svarar på går vidare till assistenten. Ert nummer är detsamma.')).toBeInTheDocument()
    expect(sent('POST', '/locations/loc-1/phone-agent/setup')[0].body).toEqual({ operator: 'telia', version: 2 })
    // Fungerade det inte: samma kod med 00 i stället för +, klar att kopiera.
    const help = screen.getByText('Fungerade det inte?').closest('details')!
    expect(within(help).getByText(/Setting Registration Failed/)).toBeInTheDocument()
    expect(within(help).getByLabelText('Koden **004*0046100000001#')).toBeInTheDocument()
    expect(within(help).getByText(/Ring operatörens kundtjänst och be dem slå på vidarekoppling/)).toBeInTheDocument()
    // Numret som man läser upp det för kundtjänst; Kopiera ger hela numret.
    expect(within(help).getByText('010-000 00 01')).toBeInTheDocument()
    fireEvent.click(within(help).getByRole('button', { name: 'Kopiera' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('+46100000001'))
    fireEvent.click(screen.getByRole('button', { name: 'Klart' }))
    await step(5)
    expect(sent('POST', '/locations/loc-1/phone-agent/setup')[1].body).toEqual({ forwarded: true, version: 3 })
  })

  it('asks if the page is open on the restaurant phone; Ring koden and Kopiera only after Ja', async () => {
    const ua = navigator.userAgent
    const setUa = (v: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: v })
    const open = async () => {
      const r = render(<MemoryRouter><SettingsWizard locationId="loc-1" onSaved={vi.fn()} /></MemoryRouter>)
      fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' }))
      expect(await screen.findByText('Har du öppnat den här sidan på restaurangens telefon?')).toBeInTheDocument()
      return r
    }
    try {
      setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile')
      server.config = { ...server.config, version: 1 }
      setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS, setup: { operator: 'tele2', forwardedAt: null, testedAt: null } })
      // Nej: Admin är öppet på en annan telefon, så bara koden att skriva av.
      let r = await open()
      expect(screen.queryByRole('list', { name: 'Så gör du' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Nej, jag skriver av koden' }))
      expect(screen.getByText('Ta fram restaurangens telefon (den som kunderna ringer till).')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Ring koden/ })).not.toBeInTheDocument()
      r.unmount()
      // Ja på Android: Ring koden från den här telefonen, med # som %23.
      r = await open()
      fireEvent.click(screen.getByRole('button', { name: 'Ja' }))
      expect(screen.getByRole('link', { name: 'Ring koden ##002# från den här telefonen' })).toHaveAttribute('href', 'tel:%23%23002%23')
      expect(screen.getByText('Ring koden från den här telefonen')).toBeInTheDocument()
      fireEvent.click(nextButton())
      expect(await screen.findByRole('link', { name: 'Ring koden **004*+46100000001# från den här telefonen' })).toHaveAttribute('href', 'tel:**004*+46100000001%23')
      r.unmount()
      // Ja på iPhone: Kopiera och Klistra in, en sak per rad, ingen Ring-länk.
      setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
      await open()
      fireEvent.click(screen.getByRole('button', { name: 'Ja' }))
      const lines = [...screen.getByRole('list', { name: 'Så gör du' }).querySelectorAll(':scope > li')].map((li) => li.textContent)
      expect(lines).toEqual([
        expect.stringContaining('Tryck på Kopiera'),
        'Öppna appen Telefon och gå till knappsatsen.',
        'Håll fingret på den tomma raden ovanför siffrorna.',
        'Tryck på Klistra in.',
        'Tryck på den gröna lur-knappen.',
        expect.stringContaining('Det spelar ingen roll'),
      ].map((t, i) => (typeof t === 'string' ? `${i + 1}${t}` : t)))
      expect(screen.queryByRole('link', { name: /Ring koden/ })).not.toBeInTheDocument()
    } finally {
      setUa(ua)
    }
  })

  it('gives a desk phone (Telia fast telefon) lift, dial, listen, hang up: no +, no app, no Kopiera', async () => {
    const ua = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' })
    try {
      server.config = { ...server.config, version: 1 }
      setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS, setup: { operator: 'telia_fast', forwardedAt: null, testedAt: null } })
      renderWizard()
      fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' }))
      expect(await screen.findByText(/Kod 1 av/)).toBeInTheDocument()
      expect(screen.queryByText(/Har du öppnat den här sidan/)).not.toBeInTheDocument()
      for (let i = 0; i < 3; i++) fireEvent.click(nextButton())
      expect(await screen.findByLabelText('Koden *61*0100000001#')).toBeInTheDocument()
      const lines = [...screen.getAllByRole('list', { name: 'Så gör du' })[0].querySelectorAll(':scope > li')].map((li) => li.textContent)
      expect(lines).toEqual([
        '1Lyft luren på restaurangens fasta telefon.',
        expect.stringContaining('Slå koden'),
        '3Lyssna efter en ton eller ett meddelande.',
        '4Lägg på. Tryck sedan på Nästa nedan.',
      ])
      expect(screen.queryByText(/håll fingret på/)).not.toBeInTheDocument()
      expect(screen.queryByText(/appen Telefon/)).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /Ring koden/ })).not.toBeInTheDocument()
      expect(within(screen.getByLabelText('Koden *61*0100000001#').closest('.telefon-codebox')!).queryByRole('button')).not.toBeInTheDocument()
      fireEvent.click(nextButton())
      expect(await screen.findByLabelText('Koden *67*0100000001#')).toBeInTheDocument()
      expect(screen.getByText('Lägg på. Tryck sedan på Klart nedan.')).toBeInTheDocument()
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
    }
  })

  it('shows only the code for the chosen mode: **21 for Alltid, **004 otherwise', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 2, enabled: true, number: '+46100000001', mode: 'always', agentHours: {}, setup: { operator: 'tre', forwardedAt: null, testedAt: null } })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Nästa' }))
    expect(await screen.findByLabelText('Koden **21*+46100000001#')).toBeInTheDocument()
    expect(screen.queryByText(/\*\*004\*/)).not.toBeInTheDocument()
    expect(screen.getByText('##21#')).toBeInTheDocument()
  })

  it('in the dev test mode never asks to forward to the foreign test line: Klart marks the step done', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS, simulated: true, testNumber: '+3587598999876' })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' }))
    expect(await screen.findByText('I testläget behöver du inte koppla om.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vilken operatör har restaurangens telefon?' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Koden /)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Klart' }))
    await step(5)
    expect(sent('POST', '/locations/loc-1/phone-agent/setup')[0].body).toEqual({ forwarded: true, version: 2 })
    expect(screen.getByText('+358 75 9899 9876')).toBeInTheDocument()
  })

  it('shows fixed Telia two codes one at a time, and a switchboard no code', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS, setup: { operator: 'telia_fast', forwardedAt: null, testedAt: null } })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Vidarekoppling' }))
    expect(await screen.findByText(/Kod 1 av 5/)).toBeInTheDocument()
    expect(screen.getByLabelText('Koden #21#')).toBeInTheDocument()
    fireEvent.click(nextButton())
    expect(await screen.findByText(/Kod 2 av 5/)).toBeInTheDocument()
    expect(screen.getByLabelText('Koden #61#')).toBeInTheDocument()
    fireEvent.click(nextButton())
    fireEvent.click(nextButton())
    expect(await screen.findByText(/Kod 4 av 5/)).toBeInTheDocument()
    expect(screen.getByLabelText('Koden *61*0100000001#')).toBeInTheDocument()
    // Av senare: en kod per rad, aldrig två koder i ett.
    const later = screen.getByText('Stänga av senare?').closest('details')!
    expect(within(later).getByText('#61#')).toBeInTheDocument()
    expect(within(later).getByText('#67#')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tillbaka' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tillbaka' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Tillbaka' }))
    expect(await screen.findByText(/Kod 1 av 5/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tillbaka' }))
    fireEvent.click(await screen.findByLabelText('Växel eller IP-telefoni'))
    fireEvent.click(nextButton())
    expect(await screen.findByText(/Be dem koppla restaurangens nummer till/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Koden /)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Klart' })).toBeInTheDocument()
  })

  it('saves the hours with the number when Tider was skipped, so the assistant answers', async () => {
    server.config = { ...server.config, version: 1 }
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: /Booqy-nummer, inte klart/ }))
    await step(3)
    fireEvent.click(screen.getByRole('button', { name: 'Skaffa nummer' }))
    await step(4)
    const put = sent('PUT', '/locations/loc-1/phone-agent')[0].body!
    expect(put).toMatchObject({ enabled: true, mode: 'after_hours' })
    expect((put.agentHours as Record<string, unknown>).mon).toEqual([{ from: '00:00', to: '11:00' }, { from: '22:00', to: '23:59' }])
    fireEvent.click(screen.getByRole('button', { name: 'Till checklistan' }))
    expect(await screen.findByRole('button', { name: doneRow('Tider') })).toBeInTheDocument()
  })

  it('shows the dev test line as the Booqy number everywhere, the same as in the code', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS, simulated: true, testNumber: '+358759899876' })
    renderWizard()
    expect(await screen.findByText(formatPhone('+358759899876'))).toBeInTheDocument()
    expect(screen.queryByText('+46 10 000 00 01')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: doneRow('Booqy-nummer') }))
    await step(3)
    expect(screen.getByText(formatPhone('+358759899876'))).toBeInTheDocument()
    expect(screen.getByText('Testnummer i dev')).toBeInTheDocument()
  })

  it('from Alltid to När ni har stängt: asks to forward again and turns the old forwarding off first', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 4, enabled: true, number: '+46100000001', mode: 'always', agentHours: {},
      setup: { operator: 'telia', forwardedAt: '2026-11-14T10:00:00Z', testedAt: '2026-11-14T10:05:00Z' } })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: doneRow('Tider') }))
    await step(2)
    expect(screen.getByLabelText('Alltid')).toBeChecked()
    fireEvent.click(screen.getByLabelText('När ni har stängt'))
    fireEvent.click(nextButton())
    await step(3)
    expect(server.loc.setup?.forwardedAt).toBeNull()
    fireEvent.click(nextButton())
    await step(4)
    expect(await screen.findByText('Kod 1 av 2: Först: stäng av gammal vidarekoppling')).toBeInTheDocument()
    expect(screen.getByLabelText('Koden ##002#')).toBeInTheDocument()
    fireEvent.click(nextButton())
    expect(await screen.findByLabelText('Koden **004*+46100000001#')).toBeInTheDocument()
  })

  it('keeps the draft when going back', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Namn'), { target: { value: 'Sara' } })
    fireEvent.click(nextButton())
    await step(2)
    fireEvent.click(screen.getByLabelText('Alltid'))
    fireEvent.click(screen.getByRole('button', { name: 'Tillbaka' }))
    await step(1)
    expect((screen.getByLabelText('Namn') as HTMLInputElement).value).toBe('Sara')
    fireEvent.click(nextButton())
    await step(2)
    expect(screen.getByLabelText('Alltid')).toBeChecked()
  })
})

describe('test call', () => {
  async function openTest(over: Partial<LocationConfig> = {}) {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 3, enabled: true, number: '+46100000001', agentHours: NIGHTS, setup: { operator: 'telia', forwardedAt: '2026-11-14T10:00:00Z', testedAt: null }, ...over })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Fortsätt: Provsamtal' }))
    await step(5)
  }

  const ANSWERED = (over: Partial<CallRow> = {}): CallRow => ({ callId: 'c1', startedAt: new Date().toISOString(), durationSec: 20, language: 'sv',
    outcome: 'info', counterOffer: 'none', reservationId: null, callbackId: null, summary: '', ...over })

  it('starts waiting as soon as step 5 opens and marks it done when the call shows up, with no button to tap', async () => {
    server.calls = [ANSWERED()]
    await openTest()
    expect(screen.queryByRole('button', { name: /Jag ringer nu/ })).not.toBeInTheDocument()
    expect(await screen.findByText('Det fungerar!')).toBeInTheDocument()
    await waitFor(() => expect(sent('POST', '/locations/loc-1/phone-agent/setup')[0]?.body).toEqual({ tested: true, version: 3 }))
    fireEvent.click(screen.getByRole('button', { name: 'Klar' }))
    expect(await screen.findByText(doneText)).toBeInTheDocument()
  })

  it('says to let it ring before speaking, one action per line, with the restaurant number', async () => {
    await openTest()
    expect(screen.queryByRole('button', { name: 'Klar' })).not.toBeInTheDocument()
    const lines = [...screen.getByRole('list', { name: 'Så gör du' }).querySelectorAll(':scope > li')].map((li) => li.textContent)
    expect(lines).toEqual([
      expect.stringMatching(/^1Ring det här numret från en annan telefon:08-123 456 78/),
      '2Låt det ringa. Svara inte i restaurangens telefon. Assistenten svarar efter en stund.',
      '3Säg hej och fråga till exempel ”När har ni öppet?”.',
      '4Lägg på.',
    ])
    expect(await screen.findByText('Väntar på samtalet…')).toBeInTheDocument()
    expect(screen.getByText('Vi visar här när samtalet har kommit in.')).toBeInTheDocument()
    // Ingen Ring-knapp: den här enheten kan vara restaurangens telefon.
    expect(screen.queryByRole('link', { name: /Ring från den här telefonen/ })).not.toBeInTheDocument()
  })

  it('uses the dev test line while simulated, and on a phone offers to call it from here', async () => {
    const ua = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile' })
    try {
      await openTest({ simulated: true, testNumber: '+358759899876' })
      expect(screen.getByRole('link', { name: /Ring från den här telefonen/ })).toHaveAttribute('href', 'tel:+358759899876')
      expect(screen.getByText('Testlinje i dev')).toBeInTheDocument()
      expect(screen.queryByText(/Svara inte i restaurangens telefon/)).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
    }
  })

  it('counts a call refused for the hours as working: the forwarding reached Booqy', async () => {
    server.calls = [ANSWERED({ callId: 'new', outcome: 'refused', refusedReason: 'hours' }), ANSWERED({ callId: 'old', startedAt: '2026-11-14T06:00:00Z' })]
    await openTest()
    expect(await screen.findByText('Det fungerar!')).toBeInTheDocument()
    expect(screen.getByText('Assistenten svarar när ni har stängt.')).toBeInTheDocument()
    await waitFor(() => expect(sent('POST', '/locations/loc-1/phone-agent/setup')[0]?.body).toEqual({ tested: true, version: 3 }))
  })

  it('warns about any other refusal and saves nothing', async () => {
    server.calls = [ANSWERED({ callId: 'new', durationSec: 5, outcome: 'refused', refusedReason: 'cap' })]
    await openTest()
    expect(await screen.findByText(/Samtalet kom fram men assistenten svarade inte: minuterna för perioden var slut/)).toBeInTheDocument()
    expect(sent('POST', '/locations/loc-1/phone-agent/setup')).toHaveLength(0)
  })

  it('after five minutes without a call lists what to check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openTest()
    expect(await screen.findByText('Väntar på samtalet…')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 5000) })
    expect(await screen.findByText('Inget samtal ännu?')).toBeInTheDocument()
    expect(screen.getByText(/Ringde du rätt nummer\?/)).toBeInTheDocument()
    expect(screen.getByText('Har ni gjort steg 4, Vidarekoppling?')).toBeInTheDocument()
    expect(screen.getByText('Svarade någon i restaurangens telefon? Låt den ringa tills assistenten svarar.')).toBeInTheDocument()
    expect(screen.getByText('Tryck på Vänta igen och ring en gång till.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vänta igen' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hoppa över' }))
    expect(await screen.findByRole('button', { name: 'Fortsätt: Provsamtal' })).toBeInTheDocument()
    expect(sent('POST', '/locations/loc-1/phone-agent/setup')).toHaveLength(0)
  })

  it('says it is our fault after three failed polls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const down = () => new ApiError(503, 'service_unavailable', { fromServer: true })
    server.fail['GET /locations/loc-1/phone-agent/calls'] = [down(), down(), down()]
    await openTest()
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(await screen.findByText(/^Vi ser inte provsamtalet just nu\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rapportera till Booqy' })).toBeInTheDocument()
  })
})

describe('Fler inställningar', () => {
  it('refuses the restaurant number as transfer target inline and has the text simulator', async () => {
    renderWizard()
    await screen.findByRole('button', { name: 'Börja' })
    const group = screen.getByRole('form', { name: 'Koppla samtal till' })
    fireEvent.change(within(group).getByLabelText('Nummer'), { target: { value: '08-123 456 78' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Spara' }))
    expect(await within(group).findByText('Det numret går redan till Booqy. Välj ett annat, till exempel en mobil.')).toBeInTheDocument()
    expect(sent('PUT', '/locations/loc-1/phone-agent')).toHaveLength(0)
    const sim = screen.getByRole('region', { name: 'Prova att skriva' })
    fireEvent.change(within(sim).getByLabelText('Du säger'), { target: { value: 'Ett bord för fyra' } })
    fireEvent.click(within(sim).getByRole('button', { name: 'Skicka' }))
    expect(await within(sim).findByText('Hej, jag kan hjälpa till.')).toBeInTheDocument()
  })

  it('requires a reason when recording is turned on', async () => {
    renderWizard()
    await screen.findByRole('button', { name: 'Börja' })
    const group = screen.getByRole('form', { name: 'Inspelning' })
    fireEvent.click(within(group).getByLabelText('Spela in samtalen'))
    fireEvent.click(within(group).getByRole('button', { name: 'Spara' }))
    expect(await within(group).findByText('Skriv varför, minst 5 tecken.')).toBeInTheDocument()
    fireEvent.change(within(group).getByLabelText('Varför spelar ni in?'), { target: { value: 'Kvalitet och utbildning' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(sent('PUT', '/tenant/phone-agent/config')[0]?.body).toMatchObject({
      recording: { enabled: true, purpose: 'Kvalitet och utbildning', retentionDays: 30 } }))
  })

  it('stays open and keeps unsaved edits in other groups after Spara', async () => {
    renderWizard()
    await screen.findByRole('button', { name: 'Börja' })
    const more = screen.getByText('Fler inställningar').closest('details')!
    fireEvent.click(within(more).getByText('Fler inställningar'))
    await waitFor(() => expect(more.open).toBe(true))
    const greet = screen.getByRole('form', { name: 'Hälsning' })
    fireEvent.change(within(greet).getByLabelText('Svenska'), { target: { value: 'Vad kan jag hjälpa dig med?' } })
    const tone = screen.getByRole('form', { name: 'Ton' })
    chooseOption(within(tone).getByLabelText('Ton'), 'formal')
    fireEvent.click(within(tone).getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(server.config.tone).toBe('formal'))
    await waitFor(() => expect(server.config.version).toBe(1))
    const after = screen.getByText('Fler inställningar').closest('details')!
    expect(after.open).toBe(true)
    expect((within(screen.getByRole('form', { name: 'Hälsning' })).getByLabelText('Svenska') as HTMLInputElement).value).toBe('Vad kan jag hjälpa dig med?')
  })

  it('shows and keeps every span of a day: editing the morning never drops the evening', async () => {
    setLoc({ version: 2, agentHours: NIGHTS })
    renderWizard()
    await screen.findByRole('button', { name: /Fortsätt/ })
    const group = screen.getByRole('form', { name: 'Tider' })
    expect((within(group).getByLabelText('Måndag till (2)') as HTMLInputElement).value).toBe('23:59')
    fireEvent.change(within(group).getByLabelText('Måndag till'), { target: { value: '10:00' } })
    fireEvent.click(within(group).getByRole('button', { name: 'Lägg till tid tisdag' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Spara' }))
    await waitFor(() => expect(sent('PUT', '/locations/loc-1/phone-agent')[0]?.body?.agentHours).toEqual({
      mon: [{ from: '00:00', to: '10:00' }, { from: '22:00', to: '23:59' }], tue: [{ from: '17:00', to: '23:00' }] }))
    fireEvent.click(within(group).getByRole('button', { name: 'Ta bort måndag 22:00-23:59' }))
    expect(within(group).queryByLabelText('Måndag till (2)')).not.toBeInTheDocument()
    expect(within(group).getByLabelText('Måndag till')).toBeInTheDocument()
  })

  it('asks before turning the assistant off', async () => {
    server.config = { ...server.config, version: 1 }
    setLoc({ version: 2, enabled: true, number: '+46100000001', agentHours: NIGHTS })
    renderWizard()
    fireEvent.click(await screen.findByRole('button', { name: 'Stäng av assistenten för platsen' }))
    expect(screen.getByText('Stäng av? Numret sparas i 30 dagar.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(sent('PUT', '/locations/loc-1/phone-agent')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Stäng av assistenten för platsen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stäng av' }))
    await waitFor(() => expect(sent('PUT', '/locations/loc-1/phone-agent')[0]?.body).toMatchObject({ enabled: false }))
  })
})
