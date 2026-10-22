import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CateringkalkylPage from './CateringkalkylPage'

const saveSettings = vi.fn()
const listTiers = vi.fn()
const updateTier = vi.fn()
vi.mock('../catering/cateringApi', async (orig) => ({
  ...(await orig<typeof import('../catering/cateringApi')>()),
  saveSettings: (...a: unknown[]) => saveSettings(...a),
  listTiers: (...a: unknown[]) => listTiers(...a),
  updateTier: (...a: unknown[]) => updateTier(...a),
}))
vi.mock('../installningar/locationApi', () => ({
  getLocation: () => Promise.resolve({ cateringSettings: { enabled: false, minPortions: 15, notifyEmail: 'boss@example.se',
    cleaningFee: 350 } }),
}))
vi.mock('../meny/menuApi', () => ({
  listMenuItems: () => Promise.resolve([]),
  getPublicMenu: () => Promise.resolve([]),
  toDish: (x: unknown) => x,
  publicToDish: (x: unknown) => x,
}))
vi.mock('../../shared/AdminTopbar', () => ({
  AdminTopbar: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
}))
vi.mock('../../shared/tenant', () => ({ useTenant: () => ({ tenant: { role: 'owner_user' } }) }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))

const TIER = { tierId: 't1', name: 'Nivå 1', fromPortions: 30, toPortions: null, discountPercent: 5, active: true }

beforeEach(() => {
  saveSettings.mockReset()
  listTiers.mockReset()
  updateTier.mockReset()
  listTiers.mockResolvedValue([TIER])
})

describe('CateringkalkylPage', () => {
  it('loads saved settings and tiers from the API', async () => {
    render(<CateringkalkylPage />)
    expect(await screen.findByText('Nivå 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Minsta antal portioner (totalt)')).toHaveValue('15 st')
    expect(screen.getByLabelText('Nya förfrågningar till e-post')).toHaveValue('boss@example.se')
    expect(screen.queryByText(/MOCK|exempeldata/i)).not.toBeInTheDocument()
  })

  it('turns the calculator on and saves', async () => {
    const user = userEvent.setup()
    saveSettings.mockImplementation((_l: string, s: object) => Promise.resolve(s))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    await user.click(screen.getByRole('switch', { name: 'Visa kalkylen för kunder på webbplatsen' }))
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }))
    expect(saveSettings).toHaveBeenCalledWith('loc-1', expect.objectContaining({ enabled: true, minPortions: 15 }))
    expect(await screen.findByText('Sparat. Kalkylen visas på webbplatsen.')).toBeInTheDocument()
  })

  it('changes the cleaning fee and saves it', async () => {
    const user = userEvent.setup()
    saveSettings.mockImplementation((_l: string, s: object) => Promise.resolve(s))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    const fee = screen.getByLabelText('Rengöringsavgift, ej rengjord utrustning (inkl. moms)')
    expect(fee).toHaveValue('350 kr')
    await user.clear(fee)
    await user.type(fee, '450')
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }))
    expect(saveSettings).toHaveBeenCalledWith('loc-1', expect.objectContaining({ cleaningFee: 450 }))
  })

  it('toggles a tier through the API', async () => {
    const user = userEvent.setup()
    updateTier.mockResolvedValue({ ...TIER, active: false })
    render(<CateringkalkylPage />)
    await user.click(await screen.findByRole('switch', { name: 'Nivå 1 aktiv' }))
    expect(updateTier).toHaveBeenCalledWith('loc-1', 't1', expect.objectContaining({ active: false }))
  })
})
