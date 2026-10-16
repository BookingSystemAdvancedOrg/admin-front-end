import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from './context'
import type { AuthContextValue } from './context'
import ResetPasswordPage from './ResetPasswordPage'

const confirmPasswordReset = vi.fn()
vi.mock('./cognito', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cognito')>()
  return {
    ...actual,
    confirmPasswordReset: (email: string, code: string, pw: string) =>
      confirmPasswordReset(email, code, pw),
  }
})

const login = vi.fn()
const auth: AuthContextValue = {
  status: 'signed-out',
  email: null,
  sub: null,
  groups: [],
  hasPendingNewPassword: false,
  login: (email, pw) => login(email, pw),
  finishNewPassword: vi.fn(),
  logout: vi.fn(),
  getToken: vi.fn(),
}

function Where() {
  const location = useLocation()
  const state = location.state as { email?: string } | null
  return (
    <p data-testid="where">
      {location.pathname}
      {location.hash} {state?.email ?? ''}
    </p>
  )
}

function ResetWithAddressBar() {
  const location = useLocation()
  return (
    <>
      <ResetPasswordPage />
      <p data-testid="address">{location.pathname + location.hash}</p>
    </>
  )
}

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/aterstall-losenord" element={<ResetWithAddressBar />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const LINK = '/aterstall-losenord#code=123456&email=anna%40kallarestaurang.se'
const PASSWORD = 'Nytt-Lösen1'

async function choosePassword(user: ReturnType<typeof userEvent.setup>, pw = PASSWORD, again = pw) {
  await user.type(screen.getByLabelText('Nytt lösenord'), pw)
  await user.type(screen.getByLabelText('Bekräfta lösenord'), again)
  await user.click(screen.getByRole('button', { name: 'Spara nytt lösenord' }))
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    confirmPasswordReset.mockReset()
    confirmPasswordReset.mockResolvedValue(undefined)
    login.mockReset()
    login.mockResolvedValue('ok')
  })

  it('from the emailed link only asks for the new password, then signs in', async () => {
    const user = userEvent.setup()
    renderAt(LINK)

    expect(screen.getByText(/För/)).toHaveTextContent('anna@kallarestaurang.se')
    expect(screen.queryByLabelText('E-post')).toBeNull()
    expect(screen.queryByLabelText('Kod från mejlet')).toBeNull()

    await choosePassword(user)

    expect(confirmPasswordReset).toHaveBeenCalledWith('anna@kallarestaurang.se', '123456', PASSWORD)
    expect(login).toHaveBeenCalledWith('anna@kallarestaurang.se', PASSWORD)
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/\s*$/)
  })

  it('takes the code out of the address bar', async () => {
    renderAt(LINK)

    expect(await screen.findByTestId('address')).toHaveTextContent(/^\/aterstall-losenord$/)
    // The page still knows the link.
    expect(screen.getByText(/För/)).toHaveTextContent('anna@kallarestaurang.se')
  })

  it('without a link asks for the address and the code from the email', async () => {
    const user = userEvent.setup()
    renderAt({ pathname: '/aterstall-losenord', state: { email: 'anna@kallarestaurang.se' } })

    expect(screen.getByLabelText('E-post')).toHaveValue('anna@kallarestaurang.se')
    await user.type(screen.getByLabelText('Kod från mejlet'), '12 34 56')
    await choosePassword(user)

    expect(confirmPasswordReset).toHaveBeenCalledWith('anna@kallarestaurang.se', '123456', PASSWORD)
  })

  it('checks the code, the rules and the repeat before sending', async () => {
    const user = userEvent.setup()
    renderAt('/aterstall-losenord')

    await user.type(screen.getByLabelText('E-post'), 'anna@kallarestaurang.se')
    await user.type(screen.getByLabelText('Kod från mejlet'), '123')
    await choosePassword(user)
    expect(screen.getByRole('alert')).toHaveTextContent('Koden är de sex siffrorna i mejlet.')

    await user.type(screen.getByLabelText('Kod från mejlet'), '456')
    await user.clear(screen.getByLabelText('Nytt lösenord'))
    await user.clear(screen.getByLabelText('Bekräfta lösenord'))
    await choosePassword(user, PASSWORD, PASSWORD + 'x')
    expect(screen.getByRole('alert')).toHaveTextContent('Lösenorden matchar inte.')

    expect(confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('keeps the save button off until every rule is met', async () => {
    const user = userEvent.setup()
    renderAt(LINK)

    await user.type(screen.getByLabelText('Nytt lösenord'), 'Nyttlosen1')
    await user.type(screen.getByLabelText('Bekräfta lösenord'), 'Nyttlosen1')

    expect(screen.getByRole('button', { name: 'Spara nytt lösenord' })).toBeDisabled()
    expect(screen.getByText('Minst ett specialtecken, t.ex. ! ? # %').closest('li')).not.toHaveClass('met')
  })

  it('offers a new link when the code no longer works', async () => {
    const user = userEvent.setup()
    const { PasswordResetError } = await import('./cognito')
    confirmPasswordReset.mockRejectedValue(new PasswordResetError(400, 'code expired'))
    renderAt(LINK)

    await choosePassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Länken har gått ut')
    await user.click(screen.getByRole('link', { name: 'Begär en ny länk' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/glomt-losenord anna@kallarestaurang.se')
    expect(login).not.toHaveBeenCalled()
  })

  it('a weak password is not a reason for a new link', async () => {
    const user = userEvent.setup()
    const { PasswordResetError } = await import('./cognito')
    confirmPasswordReset.mockRejectedValue(
      new PasswordResetError(400, 'password does not meet requirements'),
    )
    renderAt(LINK)

    await choosePassword(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Lösenordet uppfyller inte kraven.')
    expect(screen.queryByRole('link', { name: 'Begär en ny länk' })).toBeNull()
  })

  it('if signing in afterwards fails, says the password changed and leads to sign in', async () => {
    const user = userEvent.setup()
    login.mockRejectedValue(new Error('Kontot är avstängt.'))
    renderAt(LINK)

    await choosePassword(user)

    expect(await screen.findByRole('heading', { name: 'Lösenordet är bytt' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Till inloggningen' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/logga-in anna@kallarestaurang.se')
  })
})
