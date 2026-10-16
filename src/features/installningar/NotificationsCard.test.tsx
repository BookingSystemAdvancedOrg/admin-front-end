import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tenant } from '../../shared/tenant'
import { NotificationsCard } from './NotificationsCard'

const updateTenant = vi.fn()
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  updateTenant: (...args: unknown[]) => updateTenant(...args),
  replaceTenant: vi.fn(),
}))

function tenant(extra: Partial<Tenant> = {}): Tenant {
  return {
    tenantId: 't1', name: 'Roma', slug: 'roma', status: 'active', planId: null,
    entitlements: { maxLocations: 3, features: {} }, locationCount: 1,
    stripe: { connected: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false },
    primaryDomain: null, senderName: null, replyToEmail: null,
    notifications: { sms: false, staffEmails: true, reminderHours: 24 },
    role: 'owner_user', locations: [], ...extra,
  }
}

describe('NotificationsCard', () => {
  beforeEach(() => updateTenant.mockReset())

  it('saves SMS on with a sender name and a new reminder time', async () => {
    const user = userEvent.setup()
    updateTenant.mockResolvedValue(tenant({ senderName: 'Roma', notifications: { sms: true, staffEmails: true, reminderHours: 2 } }))
    render(<NotificationsCard tenant={tenant()} isOwner />)

    await user.click(screen.getByRole('switch', { name: 'SMS till gästen' }))
    await user.type(screen.getByLabelText('Avsändarnamn i SMS'), 'Roma')
    await user.selectOptions(screen.getByLabelText('Påminnelse före besöket'), '2')
    await user.click(screen.getByRole('button', { name: 'Spara notiser' }))

    expect(updateTenant).toHaveBeenCalledWith({
      notifications: { sms: true, staffEmails: true, reminderHours: 2 },
      senderName: 'Roma',
    })
    expect(await screen.findByText('Sparat.')).toBeInTheDocument()
  })

  it('requires a sender name before turning SMS on', async () => {
    const user = userEvent.setup()
    render(<NotificationsCard tenant={tenant()} isOwner />)
    await user.click(screen.getByRole('switch', { name: 'SMS till gästen' }))
    await user.click(screen.getByRole('button', { name: 'Spara notiser' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ange ett avsändarnamn')
    expect(updateTenant).not.toHaveBeenCalled()
  })

  it('is read-only for staff', () => {
    render(<NotificationsCard tenant={tenant({ role: 'staff_user' })} isOwner={false} />)
    expect(screen.getByRole('switch', { name: 'SMS till gästen' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Spara notiser' })).toBeNull()
  })

  it('survives an older API without notification settings', () => {
    const old = { ...tenant(), notifications: undefined } as unknown as Tenant
    render(<NotificationsCard tenant={old} isOwner />)
    expect(screen.getByLabelText('Påminnelse före besöket')).toHaveValue('24')
  })
})
