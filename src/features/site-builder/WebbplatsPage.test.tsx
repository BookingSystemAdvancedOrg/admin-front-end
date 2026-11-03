import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebbplatsPage, { POLL_LIMIT, waitForPublish } from './WebbplatsPage'
import * as api from './api'
import { ApiError } from '../../shared/api'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant }),
  currentLocation: () => ({ locationId: 'loc-1', name: 'Bistro' }),
}))
vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../meny/menuApi', () => ({ listMenuItems: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  getSite: vi.fn(), saveDraft: vi.fn(), createPreviewLink: vi.fn(), publish: vi.fn(), publishStatus: vi.fn(),
  listVersions: vi.fn(), rollback: vi.fn(),
}))

const doc: api.SiteDoc = {
  schemaVersion: 1, theme: { primaryColor: '#350001', accentColor: '#350001', font: 'serif' },
  nav: [{ pageId: 'start' }], footer: { text: 'Bistro' },
  pages: [{ id: 'start', slug: '', title: 'Bistro', seo: { title: 'Bistro', description: '' },
    blocks: [{ id: 'hero', type: 'hero', heading: 'Välkommen' }, { id: 'meny', type: 'menu' }] }],
}
const on = { role: 'owner_user', entitlements: { maxLocations: null, features: { siteBuilder: true } } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getSite).mockResolvedValue({ mode: 'builder', draft: { doc, version: 3, basedOn: null } })
})

describe('WebbplatsPage', () => {
  it('says the feature is not in the plan while it is off', () => {
    tenant = { role: 'owner_user', entitlements: { maxLocations: null, features: {} } }
    render(<WebbplatsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Webbplats' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ingår inte i er plan' })).toBeInTheDocument()
    expect(api.getSite).not.toHaveBeenCalled()
  })

  it('tells staff it is for the owner', () => {
    tenant = { role: 'staff_user', entitlements: { maxLocations: null, features: { siteBuilder: true } } }
    render(<WebbplatsPage />)
    expect(screen.getByRole('heading', { name: 'Bara för ägare' })).toBeInTheDocument()
    expect(api.getSite).not.toHaveBeenCalled()
  })

  it('edits, reorders with the keyboard-reachable buttons and saves the draft with its version', async () => {
    tenant = on
    vi.mocked(api.saveDraft).mockResolvedValue({ doc, version: 4, basedOn: null })
    render(<WebbplatsPage />)
    expect(await screen.findByText('Utkast · inte publicerad än')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Flytta ner Stor rubrik' }))
    fireEvent.click(screen.getByRole('button', { name: 'Spara utkast' }))
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledTimes(1))
    const [saved, version] = vi.mocked(api.saveDraft).mock.calls[0]
    expect(version).toBe(3)
    expect(saved.pages[0].blocks.map((b) => b.type)).toEqual(['menu', 'hero'])
  })

  it('publishes and waits until the version is live', async () => {
    tenant = on
    vi.mocked(api.publish).mockResolvedValue({ publishId: 'p', status: 'running' })
    vi.mocked(api.publishStatus).mockResolvedValue({ status: 'done', versionNo: 1 })
    render(<WebbplatsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Publicera' }))
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(expect.any(String), 3))
    await waitFor(() => expect(api.publishStatus).toHaveBeenCalled(), { timeout: 4000 })
    await waitFor(() => expect(api.getSite).toHaveBeenCalledTimes(2))
  })

  it('points at the block a refused save is about', async () => {
    tenant = on
    vi.mocked(api.saveDraft).mockRejectedValue(new ApiError(400, 'invalid_link', { code: 'invalid_link', field: '/pages/0/blocks/1/cta/link', fromServer: true }))
    render(<WebbplatsPage />)
    fireEvent.change(await screen.findByLabelText('Sidans namn'), { target: { value: 'Hem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara utkast' }))
    expect(await screen.findByText('En länk pekar på en sida som inte finns.')).toBeInTheDocument()
    expect(screen.getByText('Meny (kontrollera)')).toBeInTheDocument()
    const item = screen.getByText('Meny (kontrollera)').closest('li')!
    expect(item).toHaveClass('webbplats-block--invalid')
    expect(item).not.toHaveAttribute('aria-invalid')  // aria-invalid belongs on form fields, not a list item
  })

  it('shows a reserved or taken page address on the Adress field of that page', async () => {
    tenant = on
    vi.mocked(api.saveDraft).mockRejectedValue(new ApiError(400, 'schema_invalid', { code: 'schema_invalid', field: '/pages/1/slug', fromServer: true }))
    render(<WebbplatsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ny sida' }))
    const address = screen.getByLabelText('Adress')
    expect(address).toHaveValue('sida-2')
    fireEvent.change(address, { target: { value: 'meny' } })
    fireEvent.click(screen.getByRole('button', { name: 'Spara utkast' }))
    expect((await screen.findAllByText(api.SLUG_ERROR)).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Adress')).toHaveAttribute('aria-invalid', 'true')
  })

  it('stops waiting for a publish after about five minutes and says so', async () => {
    vi.mocked(api.publishStatus).mockResolvedValue({ status: 'running' })
    const waits: number[] = []
    expect(await waitForPublish('p', async (ms) => { waits.push(ms) })).toBeNull()
    expect(api.publishStatus).toHaveBeenCalledTimes(POLL_LIMIT)
    expect(waits.reduce((a, b) => a + b, 0)).toBe(300_000)
    vi.mocked(api.publishStatus).mockResolvedValueOnce({ status: 'done', versionNo: 2 })
    expect(await waitForPublish('p', async () => undefined)).toEqual({ status: 'done', versionNo: 2 })
  })

  it('never suggests a reserved or used address for a new page', () => {
    expect(api.freeSlug('Meny', [])).toBe('meny-2')
    expect(api.freeSlug('Sida 2', ['sida-2'])).toBe('sida-2-2')
    expect(api.locate('/pages/1/slug')).toEqual({ page: 1, slug: true })
  })

  it('moves blocks without losing any', () => {
    const blocks = doc.pages[0].blocks
    expect(api.moveBlock(blocks, 0, 1).map((b) => b.id)).toEqual(['meny', 'hero'])
    expect(api.moveBlock(blocks, 0, -1)).toBe(blocks)
    expect(api.locate('/pages/2/blocks/5/heading')).toEqual({ page: 2, block: 5 })
    expect(api.slugify('Om oss & meny')).toBe('om-oss-meny')
  })
})
