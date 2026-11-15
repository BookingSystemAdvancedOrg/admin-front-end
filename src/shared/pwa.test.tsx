import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAppCard } from '../features/installningar/DesktopAppCard'
import { NAV_FOOTER, navVisible } from './nav'
import { isIos, phoneKind, showPhoneInstallNav } from './pwa'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const SHELL_PHONE_UA = `${IPHONE} BooqyDesktop/1.3.3`

function as(ua: string, platform: string, touch: number, standalone = false) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
  // jsdom har ingen maxTouchPoints
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: standalone && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }))
}

const installItem = NAV_FOOTER.find((n) => n.label === 'Installera appen')!
const downloadItem = NAV_FOOTER.find((n) => n.label === 'Ladda ner appen')!

describe('app on the phone (PWA)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'maxTouchPoints')
  })

  it('tells iPhone, iPad and Android apart', () => {
    expect(isIos(IPHONE, 'iPhone', 5)).toBe(true)
    expect(isIos(MAC, 'MacIntel', 5)).toBe(true) // iPadOS says Macintosh
    expect(isIos(MAC, 'MacIntel', 0)).toBe(false)
    expect(phoneKind({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe('android')
    expect(phoneKind({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('other')
  })

  it('Installera appen only on phones in the browser, never installed or in the desktop app', () => {
    as(IPHONE, 'iPhone', 5)
    expect(showPhoneInstallNav()).toBe(true)
    expect(navVisible(installItem, null)).toBe(true)
    expect(navVisible(downloadItem, null)).toBe(false)
    as(MAC, 'MacIntel', 0)
    expect(navVisible(installItem, null)).toBe(false)
    expect(navVisible(downloadItem, null)).toBe(true)
    as(IPHONE, 'iPhone', 5, true)
    expect(showPhoneInstallNav()).toBe(false)
    as(SHELL_PHONE_UA, 'iPhone', 5)
    expect(showPhoneInstallNav()).toBe(false)
  })

  it('iPhone: home screen steps instead of the desktop file list', () => {
    as(IPHONE, 'iPhone', 5)
    render(<MemoryRouter><DesktopAppCard /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Appen på telefonen' })).toBeInTheDocument()
    expect(screen.getByText('Lägg till på hemskärmen')).toBeInTheDocument()
    expect(screen.queryByText('Mac med Apple-chip')).toBeNull()
  })

  it('Android without Chrome prompt: menu steps, no file list', () => {
    as(ANDROID, 'Linux armv8l', 5)
    render(<MemoryRouter><DesktopAppCard /></MemoryRouter>)
    expect(screen.getByText('Installera app')).toBeInTheDocument()
    expect(screen.queryByText('Windows 10 och 11')).toBeNull()
  })

  it('already installed: says so', () => {
    as(IPHONE, 'iPhone', 5, true)
    render(<MemoryRouter><DesktopAppCard /></MemoryRouter>)
    expect(screen.getByText(/Appen är installerad/)).toBeInTheDocument()
  })
})
