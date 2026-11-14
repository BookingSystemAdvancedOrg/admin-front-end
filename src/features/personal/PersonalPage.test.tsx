import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PersonalPage from './PersonalPage'
import * as users from '../installningar/usersApi'
import type { User } from '../installningar/usersApi'

let tenant: Record<string, unknown>
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant }) }))
vi.mock('../../shared/location', () => ({ useLocationId: () => ({ locationId: 'loc-1' }) }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner-1', groups: ['owner_user'] }) }))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))
vi.mock('../installningar/usersApi', async (orig) => ({
  ...(await orig<typeof import('../installningar/usersApi')>()),
  listUsers: vi.fn(),
  inviteUser: vi.fn(),
  deactivateUser: vi.fn(),
}))

const LOCATIONS = [
  { locationId: 'loc-1', name: 'Södermalm' },
  { locationId: 'loc-2', name: 'Vasastan' },
]
const OWNER: User = { cognitoSub: 'owner-1', role: 'owner_user', name: 'Olle Ägare', email: 'olle@example.com', phone: '+46701234567', status: 'active' } as User
const ANNA: User = { cognitoSub: 'staff-1', role: 'staff', locationId: 'loc-1', name: 'Anna Servis', email: 'anna@example.com', phone: '+46701234568', status: 'active' } as User
const BO: User = { cognitoSub: 'staff-2', role: 'staff', locationId: 'loc-2', name: 'Bo Kock', email: 'bo@example.com', phone: '+46701234569', status: 'disabled' } as User

function renderPage() {
  return render(
    <MemoryRouter>
      <PersonalPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  tenant = { role: 'owner_user', locations: LOCATIONS, entitlements: { features: {} } }
  vi.mocked(users.listUsers).mockResolvedValue([OWNER, ANNA, BO])
})

describe('PersonalPage', () => {
  it('lists the staff with their place and filters by place', async () => {
    renderPage()
    expect(await screen.findByText('Anna Servis')).toBeInTheDocument()
    expect(screen.getByText('Bo Kock')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Plats'), { target: { value: 'loc-1' } })
    expect(screen.queryByText('Bo Kock')).not.toBeInTheDocument()
    expect(screen.getByText('Anna Servis')).toBeInTheDocument()
  })

  it('never offers actions on the owner themself except editing the profile', async () => {
    renderPage()
    const row = (await screen.findByText('Olle Ägare')).closest('tr') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Redigera' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Ta bort' })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Inaktivera' })).not.toBeInTheDocument()
  })

  it('deactivates a staff member', async () => {
    vi.mocked(users.deactivateUser).mockResolvedValue({ ...ANNA, status: 'disabled' })
    renderPage()
    const row = (await screen.findByText('Anna Servis')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Inaktivera' }))
    await waitFor(() => expect(within(row).getByText('Inaktiv')).toBeInTheDocument())
    expect(users.deactivateUser).toHaveBeenCalledWith('staff-1')
  })

  it('invites staff to the chosen place', async () => {
    vi.mocked(users.inviteUser).mockResolvedValue({ ...ANNA, cognitoSub: 'staff-3', name: 'Cia Ny', email: 'cia@example.com' })
    renderPage()
    await screen.findByText('Anna Servis')
    fireEvent.click(screen.getByRole('button', { name: /Bjud in personal/ }))
    const dialog = screen.getByRole('dialog', { name: 'Bjud in personal' })
    fireEvent.change(within(dialog).getByLabelText('Namn'), { target: { value: 'Cia Ny' } })
    fireEvent.change(within(dialog).getByLabelText('E-post'), { target: { value: 'cia@example.com' } })
    fireEvent.change(within(dialog).getByLabelText('Telefon'), { target: { value: '+46701234560' } })
    fireEvent.change(within(dialog).getByLabelText('Plats'), { target: { value: 'loc-2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Skicka inbjudan' }))
    await waitFor(() => expect(screen.getByText('Cia Ny')).toBeInTheDocument())
    expect(users.inviteUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Cia Ny', email: 'cia@example.com', group: 'staff_user', locationId: 'loc-2' }),
    )
  })

  it('opens Redigera when an editable row is clicked, or Enter on it', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('anna@example.com'))
    expect(screen.getByRole('dialog', { name: 'Redigera medarbetare' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Avbryt' }))
    const row = screen.getByText('Bo Kock').closest('tr') as HTMLElement
    expect(row).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'Redigera medarbetare' })).toBeInTheDocument()
  })

  it('leaves a row the owner may not edit unclickable (another owner)', async () => {
    const OTHER = { ...OWNER, cognitoSub: 'owner-2', name: 'Ylva Ägare', email: 'ylva@example.com' } as User
    vi.mocked(users.listUsers).mockResolvedValue([OWNER, OTHER, ANNA])
    renderPage()
    const row = (await screen.findByText('Ylva Ägare')).closest('tr') as HTMLElement
    expect(row).not.toHaveClass('person-row')
    expect(row).not.toHaveAttribute('tabindex')
    fireEvent.click(row.querySelector('td') as HTMLElement)
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.queryByRole('dialog', { name: 'Redigera medarbetare' })).not.toBeInTheDocument()
  })

  it('opens the profile picture, not the editor, from the avatar', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Visa profilbilden för Anna Servis' }))
    const box = screen.getByRole('dialog', { name: 'Profilbild: Anna Servis' })
    expect(box.querySelector('.avatar--xl')?.textContent).toBe('AS')
    expect(within(box).getByText('anna@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Redigera medarbetare' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Profilbild/ })).not.toBeInTheDocument()
  })

  it('keeps the row actions to themselves', async () => {
    vi.mocked(users.deactivateUser).mockResolvedValue({ ...ANNA, status: 'disabled' })
    renderPage()
    const row = (await screen.findByText('Anna Servis')).closest('tr') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Inaktivera' }))
    await waitFor(() => expect(users.deactivateUser).toHaveBeenCalledWith('staff-1'))
    expect(screen.queryByRole('dialog', { name: 'Redigera medarbetare' })).not.toBeInTheDocument()
  })

  it('shows staff a note and never loads the list', () => {
    tenant = { role: 'staff_user', locations: LOCATIONS, entitlements: { features: {} } }
    renderPage()
    expect(screen.getByText(/Bara ägaren hanterar personalen/)).toBeInTheDocument()
    expect(users.listUsers).not.toHaveBeenCalled()
  })
})
