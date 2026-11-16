import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrivacyCard } from './PrivacyCard'
import { ApiError } from '../../shared/api'

const fail = vi.hoisted(() => ({ erase: null as Error | null, notice: null as Error | null }))
vi.mock('./privacyApi', async (orig) => {
  const real = await orig<typeof import('./privacyApi')>()
  return {
    ...real,
    eraseGuest: (...a: Parameters<typeof real.eraseGuest>) => (fail.erase ? Promise.reject(fail.erase) : real.eraseGuest(...a)),
    getPrivacyNotice: () => {
      const err = fail.notice
      fail.notice = null
      return err ? Promise.reject(err) : real.getPrivacyNotice()
    },
  }
})

// Utan VITE_API_BASE_URL kör kortet på mockdata (privacyApi.ts).

describe('PrivacyCard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    fail.erase = null
    fail.notice = null
  })

  it('shows a skeleton while the text loads, and Försök igen loads it after a failure', async () => {
    const user = userEvent.setup()
    fail.notice = new ApiError(500, 'internal_error')
    render(<PrivacyCard />)
    expect(screen.getByRole('status', { name: 'Hämtar texten' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByLabelText('Text')).toBeInTheDocument()
    expect(screen.queryByText(/Felet ligger hos Booqy/)).not.toBeInTheDocument()
  })

  it('edits and saves the privacy notice, then resets to the template', async () => {
    const user = userEvent.setup()
    render(<PrivacyCard />)
    const text = await screen.findByLabelText('Text')
    expect((text as HTMLTextAreaElement).value).toContain('## Personuppgiftsansvarig')
    expect(screen.getByText('Standardmallen (ingen egen text sparad)')).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Spara text' })
    expect(save).toBeDisabled()
    await user.clear(text)
    await user.type(text, '## Vår policy')
    await user.click(save)
    expect(await screen.findByText(/Sparat\. Gästerna ser/)).toBeInTheDocument()
    expect(screen.getByText(/Egen text, version 1/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Återställ mallen' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Återställ' }))
    expect(await screen.findByText('Standardmallen används igen.')).toBeInTheDocument()
  })

  it('refuses an empty text', async () => {
    const user = userEvent.setup()
    render(<PrivacyCard />)
    const text = await screen.findByLabelText('Text')
    await user.clear(text)
    await user.type(text, ' ')
    await user.click(screen.getByRole('button', { name: 'Spara text' }))
    expect(screen.getByRole('alert')).toHaveTextContent('kan inte vara tom')
  })

  it('looks up a guest and withdraws one channel without touching the other', async () => {
    const user = userEvent.setup()
    render(<PrivacyCard />)
    await user.type(screen.getByLabelText('E-post'), 'anna@example.se')
    await user.type(screen.getByLabelText('Telefon'), '0701234567')
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    const email = await screen.findByRole('article', { name: 'E-post' })
    const sms = screen.getByRole('article', { name: 'SMS' })
    expect(within(email).getByText('Samtycke gäller')).toBeInTheDocument()
    expect(within(email).getByText(/Samtycke lämnat \(bokning\)/)).toBeInTheDocument()
    await user.click(within(email).getByRole('button', { name: 'Återkalla samtycke' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Återkalla samtycket via e-post?' })).getByRole('button', { name: 'Återkalla' }))
    expect(await screen.findByText('Samtycket via e-post är återkallat.')).toBeInTheDocument()
    expect(within(email).getByText('Återkallat')).toBeInTheDocument()
    expect(within(email).getAllByRole('listitem')).toHaveLength(2)
    expect(within(sms).getByText('Samtycke gäller')).toBeInTheDocument()
  })

  it('exports the guest as JSON and erases after confirming', async () => {
    const user = userEvent.setup()
    const created = vi.fn(() => 'blob:x')
    URL.createObjectURL = created
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<PrivacyCard />)
    await user.type(screen.getByLabelText('E-post'), 'anna@example.se')
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    await user.click(await screen.findByRole('button', { name: 'Exportera (JSON)' }))
    expect(await screen.findByText(/Filen är nedladdad/)).toBeInTheDocument()
    expect(created).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Radera gästens uppgifter' }))
    const dialog = screen.getByRole('dialog', { name: 'Radera gästens uppgifter' })
    expect(within(dialog).getByText(/Kvitton och påskrivna avtal finns kvar/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Radera' }))
    expect(await screen.findByText(/Klart: 1 post anonymiserades/)).toBeInTheDocument()
    const email = await screen.findByRole('article', { name: 'E-post' })
    expect(within(email).getByText(/Återkallat \(radering på gästens begäran\)/)).toBeInTheDocument()
  })

  it('says an erase failure is Booqys fault with a report button', async () => {
    const user = userEvent.setup()
    fail.erase = new ApiError(500, 'internal_error')
    render(<PrivacyCard />)
    await user.type(screen.getByLabelText('E-post'), 'anna@example.se')
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    await user.click(await screen.findByRole('button', { name: 'Radera gästens uppgifter' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Radera gästens uppgifter' })).getByRole('button', { name: 'Radera' }))
    expect(await screen.findByText(/Felet ligger hos Booqy/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rapportera till Booqy' })).toBeInTheDocument()
    fail.erase = null
    await user.click(screen.getByRole('button', { name: 'Försök igen' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Radera gästens uppgifter' })).getByRole('button', { name: 'Radera' }))
    expect(await screen.findByText(/Klart: 1 post anonymiserades/)).toBeInTheDocument()
  })

  it('asks for a contact detail before searching', async () => {
    const user = userEvent.setup()
    render(<PrivacyCard />)
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    expect(screen.getByRole('alert')).toHaveTextContent('e-post, telefonnummer')
  })
})
