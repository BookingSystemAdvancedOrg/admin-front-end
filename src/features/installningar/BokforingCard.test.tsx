import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import { BokforingCard } from './BokforingCard'
import type { AccountingSettings } from './accountingApi'

const defaults = {
  sales25: '3001', sales12: '3002', sales6: '3003', vat25: '2611', vat12: '2621', vat6: '2631',
  stripe: '1580', bank: '1930', receivables: '1510', cardFees: '6570', guaranteeFees: '3990',
  tips: '2890', refundsOwed: '2890', unclassified: '2999', rounding: '3740',
}
const settings: AccountingSettings = {
  accounts: { ...defaults, stripe: '1581' }, defaults, names: { ...defaults, stripe: 'Fordringar för kontokort' },
  series: 'B', fiscalYearStartMonth: 1, version: 3,
}

const saveAccounting = vi.fn()
const exportAccounting = vi.fn()
const saveFile = vi.fn()
vi.mock('./accountingApi', async (orig) => ({
  ...(await orig<typeof import('./accountingApi')>()),
  getAccounting: async () => structuredClone(settings),
  saveAccounting: (...args: unknown[]) => saveAccounting(...args),
  exportAccounting: (...args: unknown[]) => exportAccounting(...args),
  saveFile: (...args: unknown[]) => saveFile(...args),
}))

describe('BokforingCard', () => {
  beforeEach(() => {
    saveAccounting.mockReset().mockImplementation(async (_id, body) => ({ ...settings, ...body, version: 4 }))
    exportAccounting.mockReset().mockResolvedValue({
      from: '2026-09-01', to: '2026-09-30', format: 'sie', filename: 'booqy-roma-2026-09-01-2026-09-30.se',
      mediaType: 'application/octet-stream', content: '',
      summary: { days: 30, bookedDays: 2, sales: 1234500, vat: 148140, balanced: true,
        warnings: [{ date: '2026-09-12', text: 'Stripe visar 10,00 kr i kortbetalningar.' }] },
    })
    saveFile.mockReset()
  })

  it('downloads a month as a SIE file and shows the summary and warnings', async () => {
    const user = userEvent.setup()
    render(<BokforingCard locationId="loc-1" />)
    const period = screen.getByLabelText('Period')
    const lastMonth = (period as HTMLSelectElement).value
    await user.click(screen.getByRole('button', { name: 'Ladda ner SIE-fil' }))
    const [y, m] = lastMonth.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    expect(exportAccounting).toHaveBeenCalledWith('loc-1', `${lastMonth}-01`, `${lastMonth}-${lastDay}`, 'sie')
    expect(saveFile).toHaveBeenCalled()
    const result = await screen.findByText('booqy-roma-2026-09-01-2026-09-30.se')
    const box = result.closest('.bokforing-result') as HTMLElement
    expect(within(box).getByText('12 345,00 kr')).toBeInTheDocument()
    expect(within(box).getByText('Stripe visar 10,00 kr i kortbetalningar.')).toBeInTheDocument()
  })

  it('exports a custom period as CSV and refuses a backwards range', async () => {
    const user = userEvent.setup()
    render(<BokforingCard locationId="loc-1" />)
    await user.selectOptions(screen.getByLabelText('Period'), 'egen')
    await user.selectOptions(screen.getByLabelText('Filformat'), 'csv')
    const from = screen.getByLabelText('Från och med')
    const to = screen.getByLabelText('Till och med')
    await user.clear(from)
    await user.type(from, '2026-10-10')
    await user.clear(to)
    await user.type(to, '2026-10-01')
    expect(screen.getByRole('button', { name: 'Ladda ner CSV-fil' })).toBeDisabled()
    await user.clear(to)
    await user.type(to, '2026-10-20')
    await user.click(screen.getByRole('button', { name: 'Ladda ner CSV-fil' }))
    expect(exportAccounting).toHaveBeenCalledWith('loc-1', '2026-10-10', '2026-10-20', 'csv')
  })

  it('validates four digits, saves and resets to the BAS defaults', async () => {
    const user = userEvent.setup()
    render(<BokforingCard locationId="loc-1" />)
    const stripe = await screen.findByLabelText(/Stripe-avräkning/)
    expect(stripe).toHaveValue('1581')
    expect(screen.getByText('Standard 1580')).toBeInTheDocument()
    await user.clear(stripe)
    await user.type(stripe, '15a')
    expect(stripe).toHaveValue('15')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(screen.getByText('Fyra siffror, 1000-8999.')).toBeInTheDocument()
    expect(saveAccounting).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Återställ standardkonton' }))
    expect(stripe).toHaveValue('1580')
    await user.click(screen.getByRole('button', { name: 'Spara' }))
    expect(saveAccounting).toHaveBeenCalledWith('loc-1', {
      accounts: defaults, series: 'B', fiscalYearStartMonth: 1, version: 3,
    })
    expect(await screen.findByText('Sparat.')).toBeInTheDocument()
  })

  it('explains a Stripe refusal in Swedish', async () => {
    exportAccounting.mockRejectedValue(new ApiError(502, 'stripe_refused'))
    const user = userEvent.setup()
    render(<BokforingCard locationId="loc-1" />)
    await user.click(screen.getByRole('button', { name: 'Ladda ner SIE-fil' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Stripe svarade inte')
  })
})
