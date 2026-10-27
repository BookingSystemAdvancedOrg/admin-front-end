import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
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
    render(<MemoryRouter><KassaPage /></MemoryRouter>)
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

  it('stops card payments while the control system is down and asks for a felanmälan', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><KassaPage /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: 'Mer' }))
    await user.click(await screen.findByRole('button', { name: /Stäng kontrollsystemet/ }))
    // Demon har varit nere i 40 minuter: meddelandet om felanmälan visas med länk till e-tjänsten och listan.
    expect(await screen.findByText(/Kontrollsystemet har varit nere sedan/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Felanmäl i Skatteverkets e-tjänst' })).toHaveAttribute('href', expect.stringContaining('skatteverket.se'))
    expect(screen.getAllByRole('link', { name: /Manuell försäljningslista/ })[0]).toHaveAttribute('href', expect.stringContaining('/kassa/utskrift/manuell-lista'))
    await user.click(screen.getByRole('button', { name: /Toast Skagen/ }))
    expect(await screen.findByRole('button', { name: /Ta betalt/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stäng' }))
    expect(screen.queryByText(/Kontrollsystemet har varit nere sedan/)).not.toBeInTheDocument()
    expect(screen.getByText(/Skriv upp försäljningen på den manuella listan/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Starta kontrollsystemet/ }))
  })

  it('removes an unwanted bill with "Ta bort nota"', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemoryRouter><KassaPage /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /Toast Skagen/ }))
    const remove = await screen.findByRole('button', { name: 'Ta bort nota' })
    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ta bort nota' })).not.toBeInTheDocument())
  })

  it('picks the receipts day as DD/MM/YYYY', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><KassaPage /></MemoryRouter>)
    await user.click(await screen.findByRole('button', { name: /Kvitton/ }))
    const day = await screen.findByLabelText('Dag')
    await waitFor(() => expect((day as HTMLInputElement).value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/))
    expect(day).toHaveAttribute('type', 'text')
  })
})
