import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CateringkalkylPage from './CateringkalkylPage'

const saveSettings = vi.fn()
const listTiers = vi.fn()
const updateTier = vi.fn()
const saveCateringDish = vi.fn()
const deleteCateringDish = vi.fn()
const DISH = { dishId: 'd1', name: 'Laxtallrik', description: '', pricePerPortion: 145, allergens: ['fish'],
  dietary: [], active: true, sort: 0, version: 3 }
vi.mock('../catering/cateringApi', async (orig) => ({
  ...(await orig<typeof import('../catering/cateringApi')>()),
  saveSettings: (...a: unknown[]) => saveSettings(...a),
  listTiers: (...a: unknown[]) => listTiers(...a),
  updateTier: (...a: unknown[]) => updateTier(...a),
  listCateringDishes: () => Promise.resolve([DISH]),
  listCateringPackages: () => Promise.resolve([]),
  saveCateringDish: (...a: unknown[]) => saveCateringDish(...a),
  deleteCateringDish: (...a: unknown[]) => deleteCateringDish(...a),
}))
vi.mock('../../shared/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/api')>()),
  isApiConfigured: () => true,
}))
vi.mock('../installningar/locationApi', () => ({
  getLocation: () => Promise.resolve({ cateringSettings: { enabled: false, minPortions: 15, minGuests: 15, notifyEmail: 'boss@example.se',
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
  saveCateringDish.mockReset()
  deleteCateringDish.mockReset()
  listTiers.mockResolvedValue([TIER])
})

describe('CateringkalkylPage', () => {
  it('loads saved settings and tiers from the API', async () => {
    render(<CateringkalkylPage />)
    expect(await screen.findByText('Nivå 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Minsta antal gäster')).toHaveValue('15 gäster')
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

  it('saves the delivery origin and warns when the map cannot find it', async () => {
    const user = userEvent.setup()
    saveSettings.mockImplementation((_l: string, s: object) => Promise.resolve({ ...s, originFound: false }))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    await user.type(screen.getByLabelText('Leveranser utgår från'), 'Okänd väg 1')
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }))
    expect(saveSettings).toHaveBeenCalledWith('loc-1', expect.objectContaining({ originAddress: 'Okänd väg 1' }))
    expect(await screen.findByText(/startadress hittades inte på kartan/)).toBeInTheDocument()
    expect(saveSettings.mock.calls[0][1]).not.toHaveProperty('originFound')
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

  it('creates a catering dish with allergens', async () => {
    const user = userEvent.setup()
    saveCateringDish.mockResolvedValue({ ...DISH, dishId: 'd2' })
    render(<CateringkalkylPage />)
    expect(await screen.findByText('Laxtallrik')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Ny rätt' }))
    await user.type(screen.getByLabelText('Namn'), 'Pannacotta')
    await user.type(screen.getByLabelText('Pris per portion (kr inkl. moms)'), '45,50')
    await user.click(screen.getByLabelText('Mjölk'))
    await user.click(screen.getByRole('button', { name: 'Spara rätt' }))
    expect(saveCateringDish).toHaveBeenCalledWith('loc-1', expect.objectContaining({
      name: 'Pannacotta', pricePerPortion: 45.5, allergens: ['milk'], active: true }), undefined)
  })

  it('sends the version when a dish is switched off', async () => {
    const user = userEvent.setup()
    saveCateringDish.mockResolvedValue({ ...DISH, active: false })
    render(<CateringkalkylPage />)
    await user.click(await screen.findByRole('switch', { name: 'Laxtallrik aktiv' }))
    expect(saveCateringDish).toHaveBeenCalledWith('loc-1', expect.objectContaining({ active: false }), DISH)
  })

  it('asks before deleting a dish', async () => {
    const user = userEvent.setup()
    deleteCateringDish.mockResolvedValue(undefined)
    render(<CateringkalkylPage />)
    await screen.findByText('Laxtallrik')
    await user.click(screen.getAllByRole('button', { name: 'Radera' })[0])
    expect(deleteCateringDish).not.toHaveBeenCalled()
    await user.click(screen.getByRole('dialog', { name: 'Radera Laxtallrik' }).querySelector('.danger-outline')!)
    expect(deleteCateringDish).toHaveBeenCalledWith('loc-1', 'd1')
  })

  it('saves delivery bands and lead time, and stops a gap before saving', async () => {
    const user = userEvent.setup()
    saveSettings.mockImplementation((_l: string, s: object) => Promise.resolve(s))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    await user.click(screen.getAllByRole('button', { name: '+ Lägg till intervall' })[1])
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }))
    expect(saveSettings).toHaveBeenCalledWith('loc-1', expect.objectContaining({
      deliveryBands: [{ upToKm: 25, price: 395 }], maxDeliveryKm: 25,
      leadTimeRules: [{ fromGuests: 15, toGuests: null, days: 5 }], defaultServiceIncluded: true }))
    saveSettings.mockClear()
    const from = screen.getByLabelText('Intervall 1, från antal gäster')
    await user.click(screen.getAllByRole('button', { name: '+ Lägg till intervall' })[1])
    await user.clear(screen.getByLabelText('Intervall 2, från antal gäster'))
    await user.type(screen.getByLabelText('Intervall 2, från antal gäster'), '90')
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }))
    expect(from).toHaveValue('15')
    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/luckor/)
  })
})
