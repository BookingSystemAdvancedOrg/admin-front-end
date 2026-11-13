import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TableQrPanel } from './TableQr'
import type { TableCode } from './tableQrApi'

const listTableCodes = vi.fn()
const regenerateTableCode = vi.fn()
vi.mock('./tableQrApi', async (orig) => ({
  ...(await orig<typeof import('./tableQrApi')>()),
  listTableCodes: (...a: unknown[]) => listTableCodes(...a),
  regenerateTableCode: (...a: unknown[]) => regenerateTableCode(...a),
}))
vi.mock('../../shared/tenant', async (orig) => ({
  ...(await orig<typeof import('../../shared/tenant')>()),
  useTenant: () => ({
    tenant: { name: 'Roma', locations: [{ locationId: 'loc-1', name: 'Södermalm' }, { locationId: 'loc-2', name: 'Vasastan' }] },
    locationId: 'loc-1',
  }),
}))

const seven: TableCode = {
  tableId: 't-7', label: '7', title: 'Bord 7', seats: 4, code: 'a'.repeat(22),
  url: 'https://roma.booqy.se/bestall?bord=aaaa',
}

beforeEach(() => {
  listTableCodes.mockReset()
  regenerateTableCode.mockReset()
})

describe('TableQrPanel', () => {
  it('shows the selected table\'s card with the restaurant and location name', async () => {
    listTableCodes.mockResolvedValue([seven])
    render(<TableQrPanel locationId="loc-1" tableId="t-7" mockTables={[]} version={0} />)
    const img = await screen.findByRole('img', { name: 'QR-kort för Bord 7' })
    expect(decodeURIComponent(img.getAttribute('src') ?? '')).toContain('Roma · Södermalm')
    expect(screen.getByRole('combobox', { name: 'Ladda ner Bord 7' })).toBeInTheDocument()
  })

  it('explains that a draft table gets its code when the layout is published', async () => {
    listTableCodes.mockResolvedValue([seven])
    render(<TableQrPanel locationId="loc-1" tableId="t3-square-9" mockTables={[]} version={0} />)
    expect(await screen.findByText(/Publicera layouten så får bordet sin QR-kod/)).toBeInTheDocument()
  })

  it('regenerates a stolen sticker only after confirming', async () => {
    const user = userEvent.setup()
    listTableCodes.mockResolvedValue([seven])
    regenerateTableCode.mockResolvedValue({ ...seven, code: 'b'.repeat(22), url: 'https://roma.booqy.se/bestall?bord=bbbb' })
    render(<TableQrPanel locationId="loc-1" tableId="t-7" mockTables={[]} version={0} />)
    await user.click(await screen.findByRole('button', { name: /Ny kod/ }))
    expect(regenerateTableCode).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Ja, ny kod' }))
    expect(regenerateTableCode).toHaveBeenCalledWith('loc-1', seven)
    expect(await screen.findByText(/Den gamla dekalen fungerar inte längre/)).toBeInTheDocument()
  })
})
