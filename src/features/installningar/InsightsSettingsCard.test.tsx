import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tenant } from '../../shared/tenant'
import { InsightsSettingsCard } from './InsightsSettingsCard'
import { chooseOption } from '../../test/select'

const updateTenant = vi.fn()
const updateLocation = vi.fn()
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  updateTenant: (...args: unknown[]) => updateTenant(...args),
  replaceTenant: vi.fn(),
}))
vi.mock('./locationApi', () => ({
  getLocation: async () => ({ locationId: 'loc-1', lunchUntil: undefined }),
  updateLocation: (...args: unknown[]) => updateLocation(...args),
}))

const tenant = {
  tenantId: 't1', name: 'Roma', role: 'owner_user', locations: [], insights: { staffAccess: 'operations' },
} as unknown as Tenant

describe('InsightsSettingsCard', () => {
  beforeEach(() => {
    updateTenant.mockReset().mockResolvedValue({ ...tenant, insights: { staffAccess: 'none' } })
    updateLocation.mockReset().mockResolvedValue({ locationId: 'loc-1', lunchUntil: '16:00' })
  })

  it('moves the lunch split (staff access is under Behörigheter now)', async () => {
    const user = userEvent.setup()
    render(<InsightsSettingsCard locationId="loc-1" />)
    const select = await screen.findByLabelText('Lunchen slutar')
    expect(select).toHaveValue('15:00')
    expect(screen.queryByRole('switch')).toBeNull()
    await chooseOption(select, '16:00')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(updateTenant).not.toHaveBeenCalled()
    expect(updateLocation).toHaveBeenCalledWith('loc-1', { lunchUntil: '16:00' })
    expect(await screen.findByText('Sparat.')).toBeInTheDocument()
  })

  it('has nothing to save when the split is back where it was', async () => {
    updateLocation.mockResolvedValue({ locationId: 'loc-1' })
    render(<InsightsSettingsCard locationId="loc-1" />)
    const select = await screen.findByLabelText('Lunchen slutar')
    await chooseOption(select, '14:00')
    await chooseOption(select, '15:00')
    expect(screen.getByRole('button', { name: 'Spara' })).toBeDisabled()
  })
})
