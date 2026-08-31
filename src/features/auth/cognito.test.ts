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

  it('getCurrentSession returns null when nothing is stored', async () => {
    const { getCurrentSession } = await import('./cognito')
    await expect(getCurrentSession()).resolves.toBeNull()
  })

  it('getCurrentSession returns the stored session without refreshing when still valid', async () => {
    const { signIn, getCurrentSession } = await import('./cognito')
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
    await signIn('anna@kallarestaurang.se', 'pw')
    vi.mocked(fetch).mockClear()

    const session = await getCurrentSession()

    expect(fetch).not.toHaveBeenCalled()
    expect(session?.idToken).toBe(idToken)
  })

  it('getCurrentSession refreshes an expired session using the stored sub + refresh token', async () => {
    const { signIn, getCurrentSession } = await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: {
          AccessToken: 'access',
          IdToken: idToken,
          RefreshToken: 'refresh-token',
          ExpiresIn: -10, // already expired the instant it was issued
          TokenType: 'Bearer',
        },
      }),
    )
    await signIn('anna@kallarestaurang.se', 'pw')

    const refreshedIdToken = makeIdToken({
      sub: 'user-sub-1',
      email: 'anna@kallarestaurang.se',
      'cognito:groups': ['owner_user'],
    })
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: {
          AccessToken: 'new-access',
          IdToken: refreshedIdToken,
          ExpiresIn: 3600,
          TokenType: 'Bearer',
        },
      }),
    )

    const session = await getCurrentSession()

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/auth/refresh',
      expect.objectContaining({
        body: JSON.stringify({
          refreshToken: 'refresh-token',
          sub: 'user-sub-1',
        }),
      }),
    )
    // Cognito doesn't return a new refresh token from this flow - the old one is kept.
    expect(session?.refreshToken).toBe('refresh-token')
    expect(session?.accessToken).toBe('new-access')
  })

  it('recovers groups from the cached idToken for a session saved before the groups field existed', async () => {
    // Regression test: a session saved before `groups` existed on StoredSession
    // must not crash callers that read it, AND must not silently downgrade an
    // already-privileged user to no permissions - the idToken it already has
    // carries cognito:groups, so that's the source of truth to fall back to.
    localStorage.setItem(
      'admin-auth-session',
      JSON.stringify({
        accessToken: 'access',
        idToken, // already encodes cognito:groups: ['owner_user']
        refreshToken: 'refresh',
        sub: 'user-sub-1',
        email: 'anna@kallarestaurang.se',
        expiresAt: Date.now() + 3600_000,
        // groups: intentionally omitted
      }),
    )

    const { getCurrentSession } = await import('./cognito')
    const session = await getCurrentSession()

    expect(fetch).not.toHaveBeenCalled()
    expect(session?.groups).toEqual(['owner_user'])
  })

  it('treats a corrupt cached session as signed-out instead of crashing', async () => {
    localStorage.setItem('admin-auth-session', JSON.stringify({ garbage: true }))

    const { getCurrentSession } = await import('./cognito')
    await expect(getCurrentSession()).resolves.toBeNull()
  })

  it('getCurrentSession clears the session when refresh fails', async () => {
    const { signIn, getCurrentSession, getIdToken, getAccessToken } =
      await import('./cognito')
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(200, {
        status: 'authenticated',
        authenticationResult: {
          AccessToken: 'access',
          IdToken: idToken,
          RefreshToken: 'refresh-token',
          ExpiresIn: -10,
          TokenType: 'Bearer',
        },
      }),
    )
    await signIn('anna@kallarestaurang.se', 'pw')

    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(401, { error: 'invalid refresh token' }),
    )

    const session = await getCurrentSession()
    expect(session).toBeNull()
    await expect(getIdToken()).resolves.toBeNull()
    await expect(getAccessToken()).resolves.toBeNull()
  })
})
