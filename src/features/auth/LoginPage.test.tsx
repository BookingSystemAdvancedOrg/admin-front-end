import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from './context'
import type { AuthContextValue } from './context'
import LoginPage from './LoginPage'

const auth: AuthContextValue = {
  status: 'signed-out',
  email: null,
  sub: null,
  groups: [],
  hasPendingNewPassword: false,
  login: vi.fn(),
  finishNewPassword: vi.fn(),
  logout: vi.fn(),
  getToken: vi.fn(),
}

function Where() {
  const location = useLocation()
  return (
    <p data-testid="where">
      {location.pathname} {(location.state as { email?: string } | null)?.email ?? ''}
    </p>
  )
}

function renderLogin(state: unknown = null) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[{ pathname: '/logga-in', state }]}>
        <Routes>
          <Route path="/logga-in" element={<LoginPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('LoginPage', () => {
  it('"Glömt lösenordet?" takes the typed address along', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('E-post'), ' anna@kallarestaurang.se ')
    await user.click(screen.getByRole('link', { name: 'Glömt lösenordet?' }))

    expect(screen.getByTestId('where')).toHaveTextContent('/glomt-losenord anna@kallarestaurang.se')
  })

  it('fills in the address coming back from the reset pages', () => {
    renderLogin({ email: 'anna@kallarestaurang.se' })

    expect(screen.getByLabelText('E-post')).toHaveValue('anna@kallarestaurang.se')
  })
})
