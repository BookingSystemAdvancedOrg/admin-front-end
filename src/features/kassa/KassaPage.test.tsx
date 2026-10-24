import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import KassaPage from './KassaPage'

vi.mock('../../shared/AdminTopbar', () => ({ AdminTopbar: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ sub: 'owner' }) }))
vi.mock('../../shared/location', () => ({
  useLocationId: () => ({ locationId: 'loc-1', resolving: false, setLocationId: () => {} }),
}))

// Utan API kör kassan och kortläsaren i minnet (kassaApi och cardApi), så
// hela försäljningen går att köra här.
describe('KassaPage', () => {
  it('sells on the simulated reader and shows the receipt with control code', async () => {
    const user = userEvent.setup()
    render(<KassaPage />)
    expect(await screen.findByText('Testläge - inte ett certifierat kassaregister än')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Skapa Kassa 1' }))
    await user.click(await screen.findByRole('button', { name: /Pasta carbonara/ }))
    await user.click(screen.getByRole('button', { name: /Pasta carbonara/ }))
    await user.click(screen.getByRole('button', { name: /Kaffe/ }))
    const pay = await screen.findByRole('button', { name: 'Ta betalt 333,00 kr' })
    await waitFor(() => expect(pay).toBeEnabled())
    await user.click(pay)
    await user.click(await screen.findByRole('button', { name: /Skicka 333,00 kr till läsaren/ }))
    expect(await screen.findByText('Väntar på kort')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Simulera godkänt kort' }))
    await user.click(await screen.findByRole('button', { name: /Visa på skärmen/ }, { timeout: 5000 }))
    const receipt = await screen.findByRole('dialog', { name: 'Kvitto' })
    expect(within(receipt).getByText('Kontrollkod:')).toBeInTheDocument()
    expect(within(receipt).getAllByText('333,00')).toHaveLength(2)
  }, 15000)

  it('stops card payments while the control system is down', async () => {
    const user = userEvent.setup()
    render(<KassaPage />)
    await user.click(await screen.findByRole('button', { name: /Stäng kontrollsystemet/ }))
    expect(await screen.findByText(/inga kvitton kan skapas och inga kort dras/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Toast Skagen/ }))
    const pay = await screen.findByRole('button', { name: /Ta betalt/ })
    expect(pay).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Starta kontrollsystemet/ }))
  })
})
