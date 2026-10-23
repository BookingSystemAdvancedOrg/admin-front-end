import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrivacyCard } from './PrivacyCard'

// Utan VITE_API_BASE_URL kör kortet på mockdata (privacyApi.ts).

describe('PrivacyCard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('edits and saves the privacy notice, then resets to the template', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<PrivacyCard />)
    await user.type(screen.getByLabelText('E-post'), 'anna@example.se')
    await user.type(screen.getByLabelText('Telefon'), '0701234567')
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    const email = await screen.findByRole('article', { name: 'E-post' })
    const sms = screen.getByRole('article', { name: 'SMS' })
    expect(within(email).getByText('Samtycke gäller')).toBeInTheDocument()
    expect(within(email).getByText(/Samtycke lämnat \(bokning\)/)).toBeInTheDocument()
    await user.click(within(email).getByRole('button', { name: 'Återkalla samtycke' }))
    expect(await screen.findByText('Samtycket via e-post är återkallat.')).toBeInTheDocument()
    expect(within(email).getByText('Återkallat')).toBeInTheDocument()
    expect(within(email).getAllByRole('listitem')).toHaveLength(2)
    expect(within(sms).getByText('Samtycke gäller')).toBeInTheDocument()
  })

  it('exports the guest as JSON and erases after confirming', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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

  it('asks for a contact detail before searching', async () => {
    const user = userEvent.setup()
    render(<PrivacyCard />)
    await user.click(screen.getByRole('button', { name: 'Sök' }))
    expect(screen.getByRole('alert')).toHaveTextContent('e-post, telefonnummer')
  })
})
