import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StaffModal } from './StaffModal'
import type { User } from './usersApi'

const existingStaff: User = {
  cognitoSub: 'sub-1',
  role: 'staff',
  locationId: 'loc-1',
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

describe('StaffModal — invite mode', () => {
  it('only offers the "Personal" role when the caller is just owner_user', () => {
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['owner_user']}
        lockRole={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const roleSelect = screen.getByLabelText('Roll') as HTMLSelectElement
    const options = Array.from(roleSelect.options).map((o) => o.textContent)
    expect(options).toEqual(['Personal'])
    expect(roleSelect).toBeDisabled()
  })

  it('offers all three roles when the caller is super_user', () => {
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const roleSelect = screen.getByLabelText('Roll') as HTMLSelectElement
    const options = Array.from(roleSelect.options).map((o) => o.textContent)
    expect(options).toEqual(['Personal', 'Ägare', 'Systemadmin'])
  })

  it('shows the Plats-ID field only for the Personal role', async () => {
    const user = userEvent.setup()
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Plats-ID')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Roll'), 'Ägare')
    expect(screen.queryByLabelText('Plats-ID')).not.toBeInTheDocument()
  })

  it('keeps submit disabled until every field is valid', async () => {
    const user = userEvent.setup()
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const submit = screen.getByRole('button', { name: 'Skicka inbjudan' })
    expect(submit).toBeDisabled()

    await fillValidInvite(user)
    // Roll defaults to staff_user, so Plats-ID is still required.
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Plats-ID'), 'loc-1')
    expect(submit).toBeEnabled()
  })

  it('rejects an invalid phone number and blocks submit', async () => {
    const user = userEvent.setup()
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    await user.type(screen.getByLabelText('Namn'), 'Ny Person')
    await user.type(screen.getByLabelText('E-post'), 'ny@kallarestaurang.se')
    await user.type(screen.getByLabelText('Telefon'), '0709999999') // missing +country code
    await user.type(screen.getByLabelText('Plats-ID'), 'loc-1')

    expect(screen.getByRole('button', { name: 'Skicka inbjudan' })).toBeDisabled()
  })

  it('calls onSave with the exact form shape on submit', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    await fillValidInvite(user)
    await user.type(screen.getByLabelText('Plats-ID'), 'loc-9')
    await user.click(screen.getByRole('button', { name: 'Skicka inbjudan' }))

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        name: 'Ny Person',
        email: 'ny@kallarestaurang.se',
        phone: '+46709999999',
        group: 'staff_user',
        locationId: 'loc-9',
      }),
    )
  })

  it('shows the server error message when onSave rejects', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('E-postadressen finns redan.'))
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    await fillValidInvite(user)
    await user.type(screen.getByLabelText('Plats-ID'), 'loc-1')
    await user.click(screen.getByRole('button', { name: 'Skicka inbjudan' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-postadressen finns redan.',
    )
  })

  it('calls onCancel on Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <StaffModal
        title="Bjud in personal"
        initial={null}
        callerGroups={['super_user']}
        lockRole={false}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('StaffModal — edit mode', () => {
  it('prefills fields from the existing user and disables the role select when lockRole is set', () => {
    render(
      <StaffModal
        title="Redigera användare"
        initial={existingStaff}
        callerGroups={['super_user']}
        lockRole
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Namn')).toHaveValue('Erik Lindqvist')
    expect(screen.getByLabelText('E-post')).toHaveValue('erik@kallarestaurang.se')
    expect(screen.getByLabelText('Roll')).toBeDisabled()
    expect(screen.getByText('Du kan inte ändra din egen roll.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara ändringar' })).toBeEnabled()
  })
})
