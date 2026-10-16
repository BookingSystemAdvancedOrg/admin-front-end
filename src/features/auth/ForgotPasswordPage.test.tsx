import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPasswordPage from './ForgotPasswordPage'

const requestPasswordReset = vi.fn()
vi.mock('./cognito', () => ({
  requestPasswordReset: (email: string) => requestPasswordReset(email),
}))

function Where() {
  const location = useLocation()
  const state = location.state as { email?: string } | null
  return (
    <p data-testid="where">
      {location.pathname} {state?.email ?? ''}
    </p>
  )
}

function renderPage(email?: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/glomt-losenord', state: email ? { email } : null }]}>
      <Routes>
        <Route path="/glomt-losenord" element={<ForgotPasswordPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    requestPasswordReset.mockReset()
    requestPasswordReset.mockResolvedValue(undefined)
  })

  it('emails a link and says so without revealing whether the account exists', async () => {
    const user = userEvent.setup()
    renderPage('anna@kallarestaurang.se')

    expect(screen.getByLabelText('E-post')).toHaveValue('anna@kallarestaurang.se')
    await user.click(screen.getByRole('button', { name: 'Skicka länk' }))

    expect(requestPasswordReset).toHaveBeenCalledWith('anna@kallarestaurang.se')
    expect(await screen.findByRole('heading', { name: 'Kolla din e-post' })).toBeInTheDocument()
    expect(screen.getByText(/Finns det ett konto för/)).toHaveTextContent('anna@kallarestaurang.se')
  })

  it('checks the address first', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('E-post'), 'anna')
    await user.click(screen.getByRole('button', { name: 'Skicka länk' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Fyll i en giltig e-postadress.')
    expect(requestPasswordReset).not.toHaveBeenCalled()
  })

  it('shows the server error', async () => {
    const user = userEvent.setup()
    requestPasswordReset.mockRejectedValue(new Error('För många försök. Vänta en stund och försök igen.'))
    renderPage('anna@kallarestaurang.se')

    await user.click(screen.getByRole('button', { name: 'Skicka länk' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('För många försök')
  })

  it('can send again, and leads to the code form with the address', async () => {
    const user = userEvent.setup()
    renderPage('anna@kallarestaurang.se')
    await user.click(screen.getByRole('button', { name: 'Skicka länk' }))

    await user.click(await screen.findByRole('button', { name: 'skicka igen' }))
    expect(screen.getByRole('button', { name: 'Skicka länk' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Skicka länk' }))
    await user.click(await screen.findByRole('link', { name: 'Ange koden här' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aterstall-losenord anna@kallarestaurang.se')
  })
})
