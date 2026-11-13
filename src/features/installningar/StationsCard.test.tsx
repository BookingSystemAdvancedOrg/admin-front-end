import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StationsCard } from './StationsCard'
import type { TicketRouting } from '../bestallningar/printApi'

const saveRouting = vi.fn()
vi.mock('../bestallningar/printApi', async (orig) => ({
  ...(await orig<typeof import('../bestallningar/printApi')>()),
  saveRouting: (...a: unknown[]) => saveRouting(...a),
}))

const ROUTING: TicketRouting = {
  stations: [{ stationId: 'kok', name: 'Kök', printerIds: ['p1'] }, { stationId: 'bar', name: 'Bar', printerIds: [] }],
  categories: { starters: 'kok', mains: 'kok', desserts: 'kok', drinks: 'bar' },
  allergyTicket: true,
  version: 3,
}
const DEVICES = [{ deviceId: 'p1', name: 'Kök 1', online: true }, { deviceId: 'p2', name: 'Bar 1', online: true }]

describe('StationsCard', () => {
  it('gives the bar a printer, sends drinks nowhere and saves with the version shown', async () => {
    const user = userEvent.setup()
    saveRouting.mockImplementation((_l, r: TicketRouting) => Promise.resolve({ ...r, version: 4 }))
    render(<StationsCard locationId="loc-1" isOwner routing={ROUTING} devices={DEVICES} onSaved={() => {}} />)
    await user.click(screen.getAllByRole('checkbox', { name: 'Bar 1' })[1])
    await user.selectOptions(screen.getByLabelText('Drycker'), 'none')
    await user.click(screen.getByRole('switch', { name: 'Egen allergibong' }))
    await user.click(screen.getByRole('button', { name: 'Spara stationer' }))
    expect(saveRouting).toHaveBeenCalledWith('loc-1', {
      stations: [{ stationId: 'kok', name: 'Kök', printerIds: ['p1'] }, { stationId: 'bar', name: 'Bar', printerIds: ['p2'] }],
      categories: { starters: 'kok', mains: 'kok', desserts: 'kok', drinks: 'none' },
      allergyTicket: false,
      version: 3,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Sparat')
  })

  it('returns to the empty station name', async () => {
    const user = userEvent.setup()
    render(<StationsCard locationId="loc-1" isOwner routing={ROUTING} devices={DEVICES} onSaved={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await user.click(screen.getByRole('button', { name: 'Spara stationer' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Ge stationen ett namn')
    expect(document.activeElement).toHaveAttribute('aria-invalid', 'true')
  })
})
