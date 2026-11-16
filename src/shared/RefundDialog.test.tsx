import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { RefundDialog, parseKr, refundKr } from './RefundDialog'

function setup(props: Partial<Parameters<typeof RefundDialog>[0]> = {}) {
  const onRefund = vi.fn().mockResolvedValue(undefined)
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(
    <RefundDialog title="Återbetala avgiften" remaining={60000} onRefund={onRefund} onDone={onDone} onClose={onClose} {...props} />,
  )
  return { onRefund, onDone, onClose, user: userEvent.setup() }
}

describe('RefundDialog', () => {
  it('defaults to what is left and refunds it with the guest told', async () => {
    const { onRefund, onDone, user } = setup()
    expect(screen.getByLabelText('Belopp (kr)')).toHaveValue('600')
    expect(screen.getByText('600 kr', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByLabelText('Meddela gästen')).toBeChecked()
    expect(screen.getByText('600 kr tillbaka till gästens kort.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Återbetala 600 kr' }))
    expect(onRefund).toHaveBeenCalledWith({ amount: 60000, notifyGuest: true })
    expect(onDone).toHaveBeenCalled()
  })

  it('sends a partial amount, the reason and no notice when unticked', async () => {
    const { onRefund, user } = setup()
    const amount = screen.getByLabelText('Belopp (kr)')
    await user.clear(amount)
    await user.type(amount, '150,50')
    await user.type(screen.getByLabelText('Anledning (valfri)'), ' Kall mat ')
    await user.click(screen.getByLabelText('Meddela gästen'))
    await user.click(screen.getByRole('button', { name: 'Återbetala 150,50 kr' }))
    expect(onRefund).toHaveBeenCalledWith({ amount: 15050, reason: 'Kall mat', notifyGuest: false })
  })

  it('caps the amount at what is left', async () => {
    const { onRefund, user } = setup()
    const amount = screen.getByLabelText('Belopp (kr)')
    await user.clear(amount)
    await user.type(amount, '601')
    expect(screen.getByRole('button', { name: 'Återbetala' })).toBeDisabled()
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(onRefund).not.toHaveBeenCalled()
  })

  it('shows who acts when it fails and stays open', async () => {
    const onRefund = vi.fn().mockRejectedValue(new ApiError(409, 'refund_in_progress', { fromServer: true }))
    const { onDone, user } = setup({ onRefund })
    await user.click(screen.getByRole('button', { name: 'Återbetala 600 kr' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('En återbetalning pågår redan')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Återbetala avgiften' })).toBeInTheDocument()
  })

  it('is busy once: a double click refunds once', async () => {
    let resolve: () => void = () => {}
    const onRefund = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    const { user } = setup({ onRefund })
    const button = screen.getByRole('button', { name: 'Återbetala 600 kr' })
    await user.dblClick(button)
    expect(screen.getByRole('button', { name: 'Återbetalar…' })).toBeDisabled()
    resolve()
    expect(onRefund).toHaveBeenCalledTimes(1)
  })

  it('manual refunds say so and have no Stripe fee note; no notice box without contact details', () => {
    setup({ manual: true, canNotify: false, note: 'Presentkortets del kommer tillbaka bara om beställningen avbryts.' })
    expect(screen.getByText('600 kr betalas tillbaka för hand till gästen.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Meddela gästen')).toBeNull()
    expect(screen.queryByRole('button', { name: /Stripes avgift/ })).toBeNull()
    expect(screen.getByText(/Presentkortets del/)).toBeInTheDocument()
  })

  it('Escape closes', async () => {
    const { onClose, user } = setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('kronor', () => {
  it('parses and formats', () => {
    expect(parseKr('150')).toBe(15000)
    expect(parseKr('1 250,5')).toBe(125050)
    expect(parseKr('12.345')).toBeNull()
    expect(parseKr('abc')).toBeNull()
    expect(refundKr(125050)).toMatch(/^1\s250,50 kr$/)
  })

  it('a refund Stripe refused with a card code (402) says to check Stripe, not to use another card', async () => {
    const { user } = setup({
      onRefund: () => Promise.reject(new ApiError(402, 'balance_insufficient', { code: 'balance_insufficient', fromServer: true })),
    })
    await user.click(screen.getByRole('button', { name: 'Återbetala 600 kr' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/annat kort/)
    expect(alert.textContent).toMatch(/Kontrollera saldot i Stripe/)
  })

  it('a 409 changed_retry asks to check the amount, and a new remaining resets the amount', async () => {
    const onRefund = vi.fn().mockRejectedValue(new ApiError(409, 'changed_retry', { code: 'changed_retry', fromServer: true }))
    const props = { title: 'Återbetala avgiften', onRefund, onDone: () => {}, onClose: () => {} }
    const { rerender } = render(<RefundDialog {...props} remaining={60000} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Återbetala 600 kr' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/registrerades nyss/)
    rerender(<RefundDialog {...props} remaining={25050} />)
    expect(screen.getByLabelText('Belopp (kr)')).toHaveValue('250,50')
    expect(screen.getByText('Kvar att återbetala', { exact: false })).toHaveTextContent('250,50 kr')
  })
})
