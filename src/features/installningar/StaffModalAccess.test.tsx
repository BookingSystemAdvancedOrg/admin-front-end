import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StaffModal } from './StaffModal'
import type { User } from './usersApi'
import type { StaffAccessConfig } from '../../shared/access'

const staff: User = {
  cognitoSub: 's1', role: 'staff', locationId: 'loc-1', name: 'Ali Staff', email: 'ali@example.se', phone: '+46701234567',
  status: 'active', createdBy: 'o', createdAt: '2026-11-01T10:00:00Z',
}
const access: StaffAccessConfig = {
  areas: [], defaults: ['bokningar', 'meny'], users: { s1: { add: ['personal'], remove: [] } }, version: 4,
}
const tenant = { entitlements: { maxLocations: null, features: {} } }

function open(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <StaffModal title="Redigera medarbetare" initial={staff} callerGroups={['owner_user']} tenant={tenant}
      access={access} lockRole={false} locations={[{ locationId: 'loc-1', name: 'Södermalm' }]}
      onSave={onSave} onCancel={() => {}} />,
  )
  return onSave
}

describe('StaffModal permissions', () => {
  it('shows which ticks come from the group and which are the person own', () => {
    open()
    expect(screen.getByLabelText('Bokningar')).toBeChecked()
    expect(screen.getByLabelText('Personal')).toBeChecked()
    expect(screen.getByLabelText('Statistik')).not.toBeChecked()
    expect(screen.getAllByText('Gruppen')).toHaveLength(2)
    expect(screen.getByText('Extra')).toBeInTheDocument()
    // Planlåsta områden visas inte.
    expect(screen.queryByLabelText('Presentkort')).toBeNull()
  })

  it('saves the person changes: a group area unticked becomes removed for the person', async () => {
    const user = userEvent.setup()
    const onSave = open()
    await user.click(screen.getByLabelText('Meny'))
    expect(screen.getByText('Borttagen')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Layout'))
    await user.click(screen.getByRole('button', { name: 'Spara ändringar' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ access: { add: ['layout', 'personal'], remove: ['meny'] } }))
  })

  it('sends no permission change when nothing was ticked', async () => {
    const user = userEvent.setup()
    const onSave = open()
    // Save follows changes: only the name changes here.
    await user.type(screen.getByLabelText('Namn'), 'x')
    await user.click(screen.getByRole('button', { name: 'Spara ändringar' }))
    expect(onSave.mock.calls[0][0].access).toBeUndefined()
  })

  it('has no permission section for anyone but the owner', () => {
    render(
      <StaffModal title="Bjud in personal" initial={null} callerGroups={['staff_user']} lockRole={false}
        locations={[{ locationId: 'loc-1', name: 'Södermalm' }]} onSave={vi.fn()} onCancel={() => {}} />,
    )
    expect(screen.queryByText('Behörigheter')).toBeNull()
  })
})
