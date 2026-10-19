import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarknadsforingPage from './MarknadsforingPage'
import type { Campaign, Overview, Template } from './marketingApi'

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  listTemplates: vi.fn(),
  listStarters: vi.fn(),
  createTemplate: vi.fn(),
  previewTemplate: vi.fn(),
  listCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  audienceSize: vi.fn(),
  sendCampaign: vi.fn(),
  sendTest: vi.fn(),
  listSubscribers: vi.fn(),
  unsubscribe: vi.fn(),
  getOfferSettings: vi.fn(),
  saveOfferSettings: vi.fn(),
}))
vi.mock('./marketingApi', async (orig) => {
  const real = await orig<typeof import('./marketingApi')>()
  const wrapped = Object.fromEntries(
    Object.keys(api).map((k) => [k, (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a)]),
  )
  return { ...real, ...wrapped }
})
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../meny/menuApi', () => ({ listMenuItems: async () => [], menuImageUrl: () => null }))
vi.mock('qrcode', () => ({ default: { toDataURL: async (url: string) => `data:image/png;base64,${btoa(url)}` } }))

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant, locationId: 'loc-1' }) }))

const zero = { visits: 0, pageviews: 0, bookings: 0, guests: 0, orders: 0, catering: 0, revenueOre: 0 }
const overview: Overview = {
  from: '2026-09-20',
  to: '2026-10-19',
  totals: { ...zero, visits: 120, pageviews: 300, bookings: 6, guests: 14, orders: 3, revenueOre: 45000 },
  previous: { ...zero, visits: 100, bookings: 3 },
  channels: [{ channel: 'instagram', ...zero, visits: 80, bookings: 4 }],
  campaigns: [{ campaign: 'varmeny', channel: 'email', ...zero, visits: 20, bookings: 2 }],
  series: [{ date: '2026-10-19', ...zero, visits: 120, bookings: 6 }],
  subscribers: 42,
  emailsThisMonth: 10,
  monthlyLimit: 5000,
}
const template: Template = {
  templateId: 'a'.repeat(16),
  name: 'Vårmeny',
  subject: 'Nytt hos {restaurang}',
  preheader: '',
  blocks: [{ type: 'heading', text: 'Hej' }],
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
}
const draftCampaign: Campaign = {
  campaignId: 'b'.repeat(16),
  name: 'Vårutskick',
  templateId: template.templateId,
  subject: null,
  audience: { type: 'all' },
  status: 'draft',
  scheduledAt: null,
  startedAt: null,
  sentAt: null,
  finishedAt: null,
  createdAt: '2026-10-02T10:00:00Z',
  updatedAt: '2026-10-02T10:00:00Z',
  stats: { sent: 0 },
}

function renderAt(path = '/marknadsforing') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/marknadsforing" element={<MarknadsforingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  tenant = {
    role: 'owner_user',
    primaryDomain: 'roma.se',
    entitlements: { features: { marketing: true } },
    locations: [{ locationId: 'loc-1', name: 'Roma' }],
  }
  Object.values(api).forEach((f) => f.mockReset())
  api.getOverview.mockResolvedValue(overview)
  api.listTemplates.mockResolvedValue([template])
  api.listStarters.mockResolvedValue([])
  api.listCampaigns.mockResolvedValue([draftCampaign])
  api.audienceSize.mockResolvedValue(42)
  api.previewTemplate.mockResolvedValue({ subject: 'Nytt hos Roma', html: '<p>Hej</p>' })
  api.listSubscribers.mockResolvedValue({ subscribers: [], cursor: null })
})

describe('MarknadsforingPage', () => {
  it('is hidden when the plan does not include marketing', () => {
    tenant = { ...tenant, entitlements: { features: {} } }
    renderAt()
    expect(screen.getByText('Ingår inte i er plan')).toBeInTheDocument()
    expect(api.getOverview).not.toHaveBeenCalled()
  })

  it('is owner only', () => {
    tenant = { ...tenant, role: 'staff_user' }
    renderAt()
    expect(screen.getByText('Bara för ägare')).toBeInTheDocument()
  })

  it('shows visits, channels and campaign results', async () => {
    renderAt()
    expect(await screen.findByText('120')).toBeInTheDocument()
    expect(screen.getByText('+20 %')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('varmeny')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('creates a template from the editor with a live preview', async () => {
    api.createTemplate.mockResolvedValue(template)
    renderAt('/marknadsforing?flik=mallar')
    await userEvent.click(await screen.findByRole('button', { name: 'Ny tom mall' }))
    await waitFor(() => expect(api.previewTemplate).toHaveBeenCalled(), { timeout: 2000 })
    expect(await screen.findByTitle('Förhandsvisning av mejlet')).toHaveAttribute('sandbox', '')
    await userEvent.clear(screen.getByLabelText('Mallens namn (syns bara för er)'))
    await userEvent.type(screen.getByLabelText('Mallens namn (syns bara för er)'), 'Helg')
    await userEvent.click(screen.getByRole('button', { name: 'Spara mallen' }))
    expect(api.createTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Helg' }))
    expect(await screen.findByText('Mallen är sparad.')).toBeInTheDocument()
  })

  it('refuses to save an invalid template', async () => {
    renderAt('/marknadsforing?flik=mallar')
    await userEvent.click(await screen.findByRole('button', { name: 'Ny tom mall' }))
    await userEvent.clear(screen.getByLabelText('Ämnesrad'))
    await userEvent.click(screen.getByRole('button', { name: 'Spara mallen' }))
    expect(await screen.findByText('Ämnesraden får inte vara tom.')).toBeInTheDocument()
    expect(api.createTemplate).not.toHaveBeenCalled()
  })

  it('sends a test and then the campaign', async () => {
    api.sendTest.mockResolvedValue({ sentTo: 'agare@roma.se' })
    api.sendCampaign.mockResolvedValue({ ...draftCampaign, status: 'scheduled', scheduledAt: '2026-10-19T10:00:00Z', audienceSize: 42 })
    renderAt('/marknadsforing?flik=kampanjer')
    const row = (await screen.findByText('Vårutskick')).closest('tr') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Testa' }))
    expect(await screen.findByText('Ett testmejl är skickat till agare@roma.se.')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Skicka' }))
    const dialog = await screen.findByRole('dialog', { name: 'Skicka kampanjen' })
    expect(await within(dialog).findByText(/42 mottagare/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Skicka nu' }))
    expect(api.sendCampaign).toHaveBeenCalledWith(draftCampaign.campaignId, null)
    expect(await screen.findByText(/skickas nu till 42 mottagare/)).toBeInTheDocument()
  })

  it('builds a tracked link with a QR code', async () => {
    renderAt('/marknadsforing?flik=lankar')
    await userEvent.type(screen.getByLabelText('Kampanjnamn'), 'Affisch entrén')
    expect(await screen.findByText('https://roma.se/boka-bord?utm_source=instagram&utm_medium=social&utm_campaign=affisch-entren')).toBeInTheDocument()
    expect(await screen.findByAltText('QR-kod för länken')).toBeInTheDocument()
  })
})

describe('Välkomsterbjudande', () => {
  const view = {
    enabled: false, percent: 10, minOrderOre: 0, validDays: 30, headline: '{procent} % på din nästa beställning',
    text: 'Lämna din e-post.', buttonLabel: 'Skicka min rabattkod', imageMenuItemId: null, imageLocationId: null,
    delaySeconds: 20, scrollPercent: 40, pages: 'all', frequency: 'visit', showOnMobile: true, activeFrom: null,
    activeTo: null, imageUrl: null, dishName: null, updatedAt: null,
    stats: { views: 200, signups: 20, redeemed: 5, revenueOre: 150000, discountOre: 15000 },
  }

  it('shows results and saves the settings', async () => {
    tenant = { ...tenant, entitlements: { features: { marketing: true, ordering: true } } }
    api.getOfferSettings.mockResolvedValue(view)
    api.saveOfferSettings.mockImplementation(async (s: Record<string, unknown>) => ({ ...view, ...s }))
    renderAt('/marknadsforing?flik=erbjudande')
    expect(await screen.findByText('10 % av visningarna')).toBeInTheDocument()
    expect(screen.getByText('25 % av anmälningarna')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Visa på webbplatsen' }))
    await userEvent.selectOptions(screen.getByLabelText('Rabatt'), '15')
    await userEvent.clear(screen.getByLabelText('Minsta beställning (kr)'))
    await userEvent.type(screen.getByLabelText('Minsta beställning (kr)'), '200')
    await userEvent.click(screen.getByLabelText(/På varje sida tills gästen stänger det/))
    expect(screen.getByLabelText('Förhandsvisning av erbjudandet')).toHaveTextContent('15 % på din nästa beställning')
    await userEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(api.saveOfferSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true, percent: 15, minOrderOre: 20000, frequency: 'page',
    }))
    expect(await screen.findByText('Sparat. Erbjudandet visas nu på er webbplats.')).toBeInTheDocument()
  })

  it('refuses a headline that names another percent', async () => {
    api.getOfferSettings.mockResolvedValue(view)
    renderAt('/marknadsforing?flik=erbjudande')
    await userEvent.clear(await screen.findByLabelText('Rubrik'))
    await userEvent.type(screen.getByLabelText('Rubrik'), '20 % rabatt')
    await userEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText(/Texten säger 20 % men rabatten är 10 %/)).toBeInTheDocument()
    expect(api.saveOfferSettings).not.toHaveBeenCalled()
  })

  it('refuses an empty headline', async () => {
    api.getOfferSettings.mockResolvedValue(view)
    renderAt('/marknadsforing?flik=erbjudande')
    await userEvent.clear(await screen.findByLabelText('Rubrik'))
    await userEvent.click(screen.getByRole('button', { name: 'Spara' }))
    expect(await screen.findByText('Rubriken får inte vara tom.')).toBeInTheDocument()
    expect(api.saveOfferSettings).not.toHaveBeenCalled()
  })
})
