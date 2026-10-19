import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StaffModal } from './StaffModal'
import type { User } from './usersApi'

const LOCATIONS = [
  { locationId: 'loc-1', name: 'Hagastan' },
  { locationId: 'loc-2', name: 'Södermalm' },
]

const existingStaff: User = {
  cognitoSub: 'sub-1',
  role: 'staff',
  locationId: 'loc-2',
  name: 'Erik Lindqvist',
  email: 'erik@kallarestaurang.se',
  phone: '+46701234567',
  status: 'active',
  createdBy: 'sub-owner',
  createdAt: '2026-01-01T00:00:00Z',
}

async function fillValidInvite(user: ReturnType<typeof userEvent.setup>) {
  // userEvent.type simulates real keystrokes sequentially on one shared
  // session - running these concurrently via Promise.all interleaves
  // characters across fields, so they must be awaited one at a time.
  await user.type(screen.getByLabelText('Namn'), 'Ny Person')
  await user.type(screen.getByLabelText('E-post'), 'ny@kallarestaurang.se')
  await user.type(screen.getByLabelText('Telefon'), '+46709999999')
}

function renderInvite(overrides: Partial<Parameters<typeof StaffModal>[0]> = {}) {
  const props = {
    title: 'Bjud in personal',
    initial: null,
    callerGroups: ['owner_user'],
    lockRole: false,
    locations: LOCATIONS,
    defaultLocationId: 'loc-1',
    onSave: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<StaffModal {...props} />)
  return props
}

describe('StaffModal - invite mode', () => {
  it('lets an owner invite staff only (owners are added by the platform)', () => {
    renderInvite()
    const roleSelect = screen.getByLabelText('Roll') as HTMLSelectElement
    expect(Array.from(roleSelect.options).map((o) => o.textContent)).toEqual(['Personal'])
    expect(roleSelect).toBeDisabled()
  })

  it('picks the location by name, defaulting to the one selected in the app', () => {
    renderInvite()
    const locationSelect = screen.getByLabelText('Plats') as HTMLSelectElement
    expect(Array.from(locationSelect.options).map((o) => o.textContent)).toEqual([
      'Hagastan',
      'Södermalm',
    ])
    expect(locationSelect).toHaveValue('loc-1')
    // Ingen intern UUID visas för användaren.
    expect(screen.queryByText(/Plats-ID/)).not.toBeInTheDocument()
  })

  it('calls onSave with the exact form shape on submit', async () => {
    const user = userEvent.setup()
    const { onSave } = renderInvite()
    await fillValidInvite(user)
    await user.selectOptions(screen.getByLabelText('Plats'), 'Södermalm')
    await user.click(screen.getByRole('button', { name: 'Skicka inbjudan' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Ny Person',
        email: 'ny@kallarestaurang.se',
        phone: '+46709999999',
        group: 'staff_user',
        locationId: 'loc-2',
      }),
    )
  })

  it('blocks submit when the restaurant has no location yet', async () => {
    const user = userEvent.setup()
    renderInvite({ locations: [], defaultLocationId: undefined })
    await fillValidInvite(user)

    expect(screen.getByLabelText('Plats')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skicka inbjudan' })).toBeDisabled()
  })

  it('rejects an invalid phone number and blocks submit', async () => {
    const user = userEvent.setup()
    renderInvite()
    await user.type(screen.getByLabelText('Namn'), 'Ny Person')
    await user.type(screen.getByLabelText('E-post'), 'ny@kallarestaurang.se')
    await user.type(screen.getByLabelText('Telefon'), '0709999999') // missing +country code

    expect(screen.getByRole('button', { name: 'Skicka inbjudan' })).toBeDisabled()
  })

  it('shows the server error message when onSave rejects', async () => {
    const user = userEvent.setup()
    renderInvite({ onSave: vi.fn().mockRejectedValue(new Error('E-postadressen finns redan.')) })
    await fillValidInvite(user)
    await user.click(screen.getByRole('button', { name: 'Skicka inbjudan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('E-postadressen finns redan.')
  })

  it('calls onCancel on Escape', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderInvite()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('StaffModal - edit mode', () => {
  it('prefills fields and keeps the user on their own location', () => {
    renderInvite({ title: 'Redigera användare', initial: existingStaff })
    expect(screen.getByLabelText('Namn')).toHaveValue('Erik Lindqvist')
    expect(screen.getByLabelText('E-post')).toHaveValue('erik@kallarestaurang.se')
    expect(screen.getByLabelText('Plats')).toHaveValue('loc-2')
    expect(screen.getByRole('button', { name: 'Spara ändringar' })).toBeEnabled()
  })

  it('moves a user whose location was deleted to the selected one', () => {
    renderInvite({
      title: 'Redigera användare',
      initial: { ...existingStaff, locationId: 'loc-deleted' },
    })
    expect(screen.getByLabelText('Plats')).toHaveValue('loc-1')
  })

  it('disables the role select when lockRole is set', () => {
    renderInvite({ title: 'Redigera användare', initial: existingStaff, lockRole: true })
    expect(screen.getByLabelText('Roll')).toBeDisabled()
    expect(screen.getByText('Du kan inte ändra din egen roll.')).toBeInTheDocument()
  })
})
