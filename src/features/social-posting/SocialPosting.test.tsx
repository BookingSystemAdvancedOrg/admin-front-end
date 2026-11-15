import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InlaggTab from './InlaggTab'
import ShareDishAction from './ShareDishAction'
import * as api from './api'

vi.mock('../meny/menuApi', () => ({ menuImageUrl: () => 'https://img.example/p.jpg' }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  listPosts: vi.fn(), draftsFromMenu: vi.fn(), updatePost: vi.fn(), schedulePost: vi.fn(), cancelPost: vi.fn(), deletePost: vi.fn(),
}))

const post: api.Post = {
  postId: 'dish1-20261104', locationId: 'loc-1', source: { kind: 'dish', menuItemId: 'dish1' },
  caption: 'Pasta\n\nHemlagad\n\n149 kr', imageKey: 'menu-images/t/locations/loc-1/menu/p.jpg',
  channels: { facebook: { state: 'queued' }, instagram: { state: 'queued' } }, status: 'draft', version: 1,
}
const connected: api.Listing = { connection: { page: 'p1', instagram: 'ig1', missingPermissions: [] }, posts: [post] }

beforeEach(() => vi.clearAllMocks())

describe('InlaggTab', () => {
  it('links to the Meta connection when not connected', async () => {
    vi.mocked(api.listPosts).mockResolvedValue({ connection: { missingPermissions: ['facebook', 'instagram'] }, posts: [] })
    render(<MemoryRouter><InlaggTab /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Koppla Facebook och Instagram' })).toHaveAttribute('href', '/marknadsforing?flik=annonser')
  })

  it('opens the shared draft, shows both previews and publishes now', async () => {
    vi.mocked(api.listPosts).mockResolvedValue(connected)
    vi.mocked(api.schedulePost).mockResolvedValue({ ...post, status: 'scheduled', version: 2 })
    render(<MemoryRouter initialEntries={['/marknadsforing?flik=inlagg&inlagg=dish1-20261104']}><InlaggTab /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Facebook' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Instagram' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publicera nu' }))
    await waitFor(() => expect(api.schedulePost).toHaveBeenCalledWith(post, { now: true }))
    expect(api.updatePost).not.toHaveBeenCalled()
  })

  it('saves an edited caption before scheduling', async () => {
    vi.mocked(api.listPosts).mockResolvedValue(connected)
    const edited = { ...post, caption: 'Ny text', version: 2 }
    vi.mocked(api.updatePost).mockResolvedValue(edited)
    vi.mocked(api.schedulePost).mockResolvedValue({ ...edited, status: 'scheduled', version: 3 })
    render(<MemoryRouter initialEntries={['/?inlagg=dish1-20261104']}><InlaggTab /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText(/Text/), { target: { value: 'Ny text' } })
    fireEvent.change(screen.getByLabelText('Schemalägg till'), { target: { value: '2026-11-05T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schemalägg' }))
    await waitFor(() => expect(api.schedulePost).toHaveBeenCalled())
    expect(api.updatePost).toHaveBeenCalledWith(post, { caption: 'Ny text', channels: ['facebook', 'instagram'], alcoholConfirmed: false })
    expect(vi.mocked(api.schedulePost).mock.calls[0][1]).toEqual({ scheduledAt: api.toUtc('2026-11-05T09:00') })
  })
})

describe('ShareDishAction', () => {
  it('makes a draft and opens the Inlägg tab on it', async () => {
    vi.mocked(api.draftsFromMenu).mockResolvedValue({ posts: [post] })
    render(
      <MemoryRouter initialEntries={['/meny']}>
        <Routes>
          <Route path="/meny" element={<ShareDishAction locationId="loc-1" menuItemId="dish1" />} />
          <Route path="/marknadsforing" element={<p>inlägg öppnat</p>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dela' }))
    expect(await screen.findByText('inlägg öppnat')).toBeInTheDocument()
    expect(api.draftsFromMenu).toHaveBeenCalledWith('loc-1', ['dish1'])
  })
})
