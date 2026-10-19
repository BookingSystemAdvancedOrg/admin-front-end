import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/api', () => ({ API_BASE_URL: 'https://api.test' }))

function makeIdToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const idToken = makeIdToken({
  sub: 'user-sub-1',
  email: 'anna@kallarestaurang.se',
  'cognito:groups': ['owner_user'],
})

describe('cognito.ts (backend /auth/* client)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('signIn posts { username, password } to /auth/login', async () => {
    const { signIn } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: {
          AccessToken: 'access',
          IdToken: idToken,
          RefreshToken: 'refresh',
          ExpiresIn: 3600,
          TokenType: 'Bearer',
        },
      }),
    )

    const result = await signIn(' anna@kallarestaurang.se ', 'pw')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Booqy-Session': 'cookie' }),
        body: JSON.stringify({
          username: 'anna@kallarestaurang.se',
          password: 'pw',
        }),
      }),
    )
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.session.email).toBe('anna@kallarestaurang.se')
      expect(result.session.sub).toBe('user-sub-1')
      expect(result.session.groups).toEqual(['owner_user'])
    }
  })

  it('signIn surfaces a NEW_PASSWORD_REQUIRED challenge, falling back to the login username', async () => {
    const { signIn } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'challenge',
        challengeName: 'NEW_PASSWORD_REQUIRED',
        challengeParameters: {},
        session: 'challenge-session',
        // challengeUsername intentionally absent
      }),
    )

    const result = await signIn('anna@kallarestaurang.se', 'temp-pw')

    expect(result.kind).toBe('new-password-required')
    if (result.kind === 'new-password-required') {
      expect(result.pending).toEqual({
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: 'challenge-session',
        username: 'anna@kallarestaurang.se',
      })
    }
  })

  it('signIn maps a 401 to a Swedish "wrong credentials" message', async () => {
    const { signIn } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(401, { error: 'invalid username or password' }),
    )

    await expect(signIn('anna@kallarestaurang.se', 'wrong')).rejects.toThrow(
      'Fel e-post eller lösenord.',
    )
  })

  it('signIn maps a network/CORS failure to a friendly message instead of "Failed to fetch"', async () => {
    const { signIn } = await import('./cognito')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(signIn('anna@kallarestaurang.se', 'pw')).rejects.toThrow(
      'Kunde inte nå inloggningstjänsten',
    )
  })

  it('getCurrentSession asks the server (cookie) and is signed out on 401', async () => {
    const { getCurrentSession } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'not signed in' }))

    await expect(getCurrentSession()).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Booqy-Session': 'cookie' }),
        body: '{}',
      }),
    )
  })

  it('getCurrentSession returns the in-memory session without refreshing when still valid', async () => {
    const { signIn, getCurrentSession } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'access', IdToken: idToken, ExpiresIn: 3600, TokenType: 'Bearer' },
      }),
    )
    await signIn('anna@kallarestaurang.se', 'pw')
    vi.mocked(fetch).mockClear()

    const session = await getCurrentSession()

    expect(fetch).not.toHaveBeenCalled()
    expect(session?.idToken).toBe(idToken)
  })

  it('never writes anything about the session to web storage', async () => {
    const { signIn, getCurrentSession } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: {
          AccessToken: 'access',
          IdToken: idToken,
          // An old API answering with the token in the body: still not stored.
          RefreshToken: 'refresh',
          ExpiresIn: -10,
          TokenType: 'Bearer',
        },
      }),
    )
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const result = await signIn('anna@kallarestaurang.se', 'pw')
    await getCurrentSession()

    expect(setItem).not.toHaveBeenCalled()
    expect(result.kind === 'success' && result.session.refreshToken).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    setItem.mockRestore()
  })

  it('removes a session an older version left in localStorage', async () => {
    localStorage.setItem('admin-auth-session', JSON.stringify({ refreshToken: 'old' }))
    await import('./cognito')
    expect(localStorage.getItem('admin-auth-session')).toBeNull()
  })

  it('refreshes an expired access token through the cookie', async () => {
    const { signIn, getCurrentSession } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'access', IdToken: idToken, ExpiresIn: -10, TokenType: 'Bearer' },
      }),
    )
    await signIn('anna@kallarestaurang.se', 'pw')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'new-access', IdToken: idToken, ExpiresIn: 3600, TokenType: 'Bearer' },
      }),
    )

    const session = await getCurrentSession()

    expect(fetch).toHaveBeenLastCalledWith('https://api.test/auth/refresh', expect.objectContaining({ body: '{}' }))
    expect(session?.accessToken).toBe('new-access')
  })

  it('shares one refresh between concurrent callers (rotation-safe)', async () => {
    const { getAccessToken } = await import('./cognito')
    let resolve!: (r: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((r) => (resolve = r)))

    const a = getAccessToken()
    const b = getAccessToken()
    resolve(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'one', IdToken: idToken, ExpiresIn: 3600, TokenType: 'Bearer' },
      }),
    )

    await expect(Promise.all([a, b])).resolves.toEqual(['one', 'one'])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('signOut forgets the tokens and asks the server to revoke the cookie', async () => {
    const { signIn, signOut, getAccessToken } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'access', IdToken: idToken, ExpiresIn: 3600, TokenType: 'Bearer' },
      }),
    )
    await signIn('anna@kallarestaurang.se', 'pw')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'signed_out' }))

    await signOut()

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/auth/logout',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-Booqy-Session': 'cookie' }) }),
    )
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'not signed in' }))
    await expect(getAccessToken()).resolves.toBeNull()
  })

  it('a refresh still in flight when signing out cannot sign the user back in', async () => {
    const { getCurrentSession, signOut } = await import('./cognito')
    let resolveRefresh!: (r: Response) => void
    vi.mocked(fetch).mockImplementation((url) =>
      String(url).endsWith('/auth/refresh')
        ? new Promise<Response>((r) => (resolveRefresh = r))
        : Promise.resolve(jsonResponse(200, { status: 'signed_out' })),
    )

    const pending = getCurrentSession()
    const out = signOut()
    resolveRefresh(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'late', IdToken: idToken, ExpiresIn: 3600, TokenType: 'Bearer' },
      }),
    )

    await expect(pending).resolves.toBeNull()
    await expect(out).resolves.toBe(true)
    // The logout call went out after the refresh finished.
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(calls).toEqual(['https://api.test/auth/refresh', 'https://api.test/auth/logout'])
  })

  it('a logout that cannot reach the server finishes on the next start instead of signing back in', async () => {
    const { signOut } = await import('./cognito')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(signOut()).resolves.toBe(false)
    expect(localStorage.getItem('booqy-logout-pending')).toBe('1')

    vi.resetModules()
    vi.mocked(fetch).mockReset()
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'signed_out' }))
    const fresh = await import('./cognito')

    await expect(fresh.getCurrentSession()).resolves.toBeNull()
    expect(vi.mocked(fetch).mock.calls.map((c) => String(c[0]))).toEqual(['https://api.test/auth/logout'])
    expect(localStorage.getItem('booqy-logout-pending')).toBeNull()
  })

  it('getCurrentSession clears the session when refresh fails', async () => {
    const { signIn, getCurrentSession, getIdToken, getAccessToken } =
      await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: { AccessToken: 'access', IdToken: idToken, ExpiresIn: -10, TokenType: 'Bearer' },
      }),
    )
    await signIn('anna@kallarestaurang.se', 'pw')

    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'invalid refresh token' }))

    const session = await getCurrentSession()
    expect(session).toBeNull()
    await expect(getIdToken()).resolves.toBeNull()
    await expect(getAccessToken()).resolves.toBeNull()
  })
})

describe('forgot password (backend /auth/forgot-password and /auth/reset-password)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('asks for the reset email with the trimmed address', async () => {
    const { requestPasswordReset } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(202, { status: 'sent' }))

    await requestPasswordReset('  anna@kallarestaurang.se ')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/auth/forgot-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'anna@kallarestaurang.se' }),
      }),
    )
  })

  it('sends the code without spaces with the new password', async () => {
    const { confirmPasswordReset } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { status: 'reset' }))

    await confirmPasswordReset('anna@kallarestaurang.se', '123 456', ' Nytt-Lösen1 ')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/auth/reset-password',
      expect.objectContaining({
        body: JSON.stringify({
          username: 'anna@kallarestaurang.se',
          code: '123456',
          newPassword: ' Nytt-Lösen1 ',
        }),
      }),
    )
  })

  it.each([
    [400, 'invalid code', /fungerar inte längre/, true],
    [400, 'code expired', /gått ut/, true],
    [400, 'invalid reset request', /stämmer inte/, true],
    [400, 'password does not meet requirements', /uppfyller inte kraven/, false],
    [400, 'username must be an email address', /giltig e-postadress/, false],
    [403, 'account_disabled', /avstängt/, false],
    [429, 'too many attempts', /För många försök/, false],
    [502, 'authentication service unavailable', /Ingen kontakt/, false],
  ])('turns %i %s into a Swedish message', async (status, code, text, needsNewLink) => {
    const { PasswordResetError, confirmPasswordReset } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(status, { error: code }))

    const error = await confirmPasswordReset('a@b.se', '123456', 'Aa1!aaaa').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(PasswordResetError)
    expect((error as Error).message).toMatch(text)
    expect((error as InstanceType<typeof PasswordResetError>).needsNewLink).toBe(needsNewLink)
  })

  it('says so when the service cannot be reached', async () => {
    const { requestPasswordReset } = await import('./cognito')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(requestPasswordReset('a@b.se')).rejects.toThrow('Kunde inte nå inloggningstjänsten')
  })

  it('points a sign-in that needs a reset to "Glömt lösenordet?"', async () => {
    const { signIn } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(403, { error: 'password reset required' }))

    await expect(signIn('a@b.se', 'pw')).rejects.toThrow('Glömt lösenordet?')
  })

  it('explains a disabled account in Swedish', async () => {
    const { signIn } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(jsonResponse(403, { error: 'account_disabled' }))

    await expect(signIn('a@b.se', 'pw')).rejects.toThrow('Kontot är avstängt')
  })
})
