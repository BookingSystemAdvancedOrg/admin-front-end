import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import CateringkalkylPage from './CateringkalkylPage'

const loc = vi.hoisted(() => ({ id: 'loc-1' }))
const getLocation = vi.fn()
const saveSettings = vi.fn()
const listTiers = vi.fn()
const updateTier = vi.fn()
const createTier = vi.fn()
const deleteTier = vi.fn()
const saveCateringDish = vi.fn()
const deleteCateringDish = vi.fn()
const DISH = { dishId: 'd1', name: 'Laxtallrik', description: '', pricePerPortion: 145, allergens: ['fish'],
  dietary: [], active: true, sort: 0, version: 3 }
vi.mock('../catering/cateringApi', async (orig) => ({
  ...(await orig<typeof import('../catering/cateringApi')>()),
  saveSettings: (...a: unknown[]) => saveSettings(...a),
  listTiers: (...a: unknown[]) => listTiers(...a),
  updateTier: (...a: unknown[]) => updateTier(...a),
  createTier: (...a: unknown[]) => createTier(...a),
  deleteTier: (...a: unknown[]) => deleteTier(...a),
  listCateringDishes: () => Promise.resolve([DISH]),
  listCateringPackages: () => Promise.resolve([]),
  saveCateringDish: (...a: unknown[]) => saveCateringDish(...a),
  deleteCateringDish: (...a: unknown[]) => deleteCateringDish(...a),
}))
vi.mock('../../shared/api', async (orig) => ({
  ...(await orig<typeof import('../../shared/api')>()),
  isApiConfigured: () => true,
}))
const STORED = { cateringSettings: { enabled: false, minPortions: 15, minGuests: 15, notifyEmail: 'boss@example.se',
  cleaningFee: 350 } }
vi.mock('../installningar/locationApi', () => ({
  getLocation: (...a: unknown[]) => getLocation(...a),
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
  useLocationId: () => ({ locationId: loc.id, resolving: false, setLocationId: () => {} }),
}))

const TIER = { tierId: 't1', name: 'Nivå 1', fromPortions: 30, toPortions: null, discountPercent: 5, active: true }

beforeEach(() => {
  loc.id = 'loc-1'
  getLocation.mockReset()
  getLocation.mockResolvedValue(STORED)
  saveSettings.mockReset()
  listTiers.mockReset()
  updateTier.mockReset()
  createTier.mockReset()
  deleteTier.mockReset()
  saveCateringDish.mockReset()
  deleteCateringDish.mockReset()
  listTiers.mockResolvedValue([TIER])
})

describe('CateringkalkylPage', () => {
  it('loads saved settings and tiers from the API', async () => {
    render(<CateringkalkylPage />)
    expect(await screen.findByText('Nivå 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Minsta antal gäster')).toHaveValue('15')
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
    const fee = screen.getByLabelText('Rengöringsavgift, ej rengjord utrustning (kr inkl. moms)')
    expect(fee).toHaveValue('350')
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

  it('shows a skeleton until the settings are loaded, not the defaults', async () => {
    let finish: (v: unknown[]) => void = () => {}
    listTiers.mockReturnValue(new Promise((r) => { finish = r }))
    render(<CateringkalkylPage />)
    expect(screen.getByRole('status', { name: 'Hämtar cateringinställningarna' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Minsta antal gäster')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara inställningar' })).toBeDisabled()
    finish([TIER])
    expect(await screen.findByLabelText('Minsta antal gäster')).toHaveValue('15')
  })

  it('loads again on Försök igen when the first load fails', async () => {
    const user = userEvent.setup()
    listTiers.mockRejectedValueOnce(new ApiError(503, 'service_unavailable')).mockResolvedValue([TIER])
    render(<CateringkalkylPage />)
    await user.click(await screen.findByRole('button', { name: /Försök igen/ }))
    expect(await screen.findByText('Nivå 1')).toBeInTheDocument()
  })

  it('keeps the unit outside the field: what is shown is what is saved, and Backspace deletes digits', async () => {
    const user = userEvent.setup()
    saveSettings.mockImplementation((_l: string, s: object) => Promise.resolve(s))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    const price = screen.getByLabelText(/Intervall 1, pris/)
    expect(price).toHaveValue('395')
    await user.click(price)
    await user.keyboard('{End}{Backspace}')
    expect(price).toHaveValue('39')
    await user.type(price, ',')
    expect(price).toHaveValue('39')
    expect(screen.getByRole('alert')).toHaveTextContent('Hela kronor.')
    await user.type(price, '5')
    await user.click(screen.getByRole('button', { name: 'Spara inställningar' }))
    expect(saveSettings).toHaveBeenCalledWith('loc-1', expect.objectContaining({
      deliveryBands: [{ upToKm: 25, price: 395 }] }))
    expect(screen.queryByText('Hela kronor.')).not.toBeInTheDocument()
  })

  it('shows the skeleton again when the location changes, so the old settings cannot be saved there', async () => {
    const { rerender } = render(<CateringkalkylPage />)
    expect(await screen.findByLabelText('Minsta antal gäster')).toHaveValue('15')
    let finish: (v: unknown) => void = () => {}
    getLocation.mockReturnValueOnce(new Promise((r) => { finish = r }))
    loc.id = 'loc-2'
    rerender(<CateringkalkylPage />)
    expect(await screen.findByRole('status', { name: 'Hämtar cateringinställningarna' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spara inställningar' })).toBeDisabled()
    finish({ cateringSettings: { minGuests: 40 } })
    expect(await screen.findByLabelText('Minsta antal gäster')).toHaveValue('40')
  })

  it('drops an old load error when another location loads', async () => {
    listTiers.mockRejectedValueOnce(new ApiError(503, 'service_unavailable'))
    const { rerender } = render(<CateringkalkylPage />)
    await screen.findByRole('button', { name: /Försök igen/ })
    loc.id = 'loc-2'
    rerender(<CateringkalkylPage />)
    expect(await screen.findByText('Nivå 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Försök igen/ })).not.toBeInTheDocument()
  })

  it('refuses 7,5 % in a discount tier instead of saving 75 %', async () => {
    const user = userEvent.setup()
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    await user.click(screen.getByRole('button', { name: '+ Ny rabattnivå' }))
    const dialog = screen.getByRole('dialog', { name: 'Ny rabattnivå' })
    await user.type(within(dialog).getByLabelText('Namn på nivå'), 'Liten')
    await user.type(within(dialog).getByLabelText('Från antal gäster'), '10')
    await user.type(within(dialog).getByLabelText('Till antal gäster'), '20')
    await user.type(within(dialog).getByLabelText('Rabatt (%)'), '7,5')
    expect(within(dialog).getByText('Ange ett heltal 0-50.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Spara nivå' }))
    expect(createTier).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText('Rabatt (%)')).toHaveFocus()
  })

  it('cannot be closed while the tier is saving', async () => {
    const user = userEvent.setup()
    let fail: (e: unknown) => void = () => {}
    createTier.mockReturnValueOnce(new Promise((_r, j) => { fail = j }))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    await user.click(screen.getByRole('button', { name: '+ Ny rabattnivå' }))
    const dialog = screen.getByRole('dialog', { name: 'Ny rabattnivå' })
    await user.type(within(dialog).getByLabelText('Namn på nivå'), 'Liten')
    await user.type(within(dialog).getByLabelText('Från antal gäster'), '10')
    await user.type(within(dialog).getByLabelText('Till antal gäster'), '20')
    await user.type(within(dialog).getByLabelText('Rabatt (%)'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Spara nivå' }))
    expect(within(dialog).getByRole('button', { name: 'Avbryt' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Ny rabattnivå' })).toBeInTheDocument()
    fail(new ApiError(503, 'service_unavailable'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Felet ligger hos Booqy')
  })

  it('says the tier is gone when a colleague deleted it', async () => {
    const user = userEvent.setup()
    updateTier.mockRejectedValueOnce(new ApiError(404, 'not_found', { fromServer: true }))
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    const row = screen.getByText('Nivå 1').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Redigera' }))
    const dialog = screen.getByRole('dialog', { name: /Redigera/ })
    listTiers.mockResolvedValue([])
    await user.click(within(dialog).getByRole('button', { name: 'Spara nivå' }))
    expect(await within(dialog).findByText(/Nivån finns inte längre/)).toBeInTheDocument()
    await vi.waitFor(() => expect(listTiers).toHaveBeenCalledTimes(2))
  })

  it('keeps the tier dialog open with the error when the save fails', async () => {
    const user = userEvent.setup()
    createTier.mockRejectedValueOnce(new ApiError(503, 'service_unavailable')).mockResolvedValue({ ...TIER, tierId: 't2' })
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    await user.click(screen.getByRole('button', { name: '+ Ny rabattnivå' }))
    const dialog = screen.getByRole('dialog', { name: 'Ny rabattnivå' })
    await user.type(within(dialog).getByLabelText('Namn på nivå'), 'Liten')
    await user.type(within(dialog).getByLabelText('Från antal gäster'), '10')
    await user.type(within(dialog).getByLabelText('Till antal gäster'), '20')
    await user.type(within(dialog).getByLabelText('Rabatt (%)'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Spara nivå' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Felet ligger hos Booqy')
    expect(within(dialog).getByLabelText('Namn på nivå')).toHaveValue('Liten')
    await user.click(within(dialog).getByRole('button', { name: /Försök igen/ }))
    expect(createTier).toHaveBeenCalledTimes(2)
    expect(createTier).toHaveBeenLastCalledWith('loc-1', { name: 'Liten', fromPortions: 10, toPortions: 20,
      discountPercent: 3, active: true })
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ny rabattnivå' })).not.toBeInTheDocument())
  })

  it('asks in the Booqy dialog before deleting a tier', async () => {
    const user = userEvent.setup()
    const native = vi.spyOn(window, 'confirm')
    deleteTier.mockResolvedValue(undefined)
    render(<CateringkalkylPage />)
    await screen.findByText('Nivå 1')
    const row = screen.getByText('Nivå 1').closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Radera' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Radera Nivå 1?' })
    await user.click(within(confirm).getByRole('button', { name: 'Radera' }))
    expect(deleteTier).toHaveBeenCalledWith('loc-1', 't1')
    expect(native).not.toHaveBeenCalled()
  })
})
