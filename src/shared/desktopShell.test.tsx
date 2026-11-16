import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopAppCard } from '../features/installningar/DesktopAppCard'
import { DownloadRedirect } from '../features/installningar/DownloadRedirect'
import { actionAllowed, entryVisible, KB, viewOf } from '../features/help/kb'
import { isDesktopShell } from './desktopDownloads'
import { NAV_FOOTER, navVisible } from './nav'

/**
 * Inget om nedladdning i skrivbordsappen: varje yta kollar isDesktopShell().
 * Skalet känns igen på BooqyDesktop/<version> i user agent.
 */
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const SHELL = `${BROWSER} BooqyDesktop/1.2.0 BooqyGlass/vibrancy`

function as(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
}

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.hash}</p>
}

const downloadItem = NAV_FOOTER.find((n) => n.label === 'Ladda ner appen')!
const downloadEntry = KB.entries.find((e) => e.id === 'ladda-ner-appen')!

describe('download UI only outside the desktop app', () => {
  afterEach(() => vi.restoreAllMocks())

  it('isDesktopShell reads the shell flag from the user agent', () => {
    expect(isDesktopShell(SHELL)).toBe(true)
    expect(isDesktopShell(BROWSER)).toBe(false)
  })

  it('side menu: no Ladda ner appen in the shell', () => {
    as(SHELL)
    expect(navVisible(downloadItem, null)).toBe(false)
    as(BROWSER)
    expect(navVisible(downloadItem, null)).toBe(true)
  })

  it('settings card: renders nothing in the shell', () => {
    as(SHELL)
    const { container } = render(<MemoryRouter><DesktopAppCard /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('settings card: shows in a browser', () => {
    as(BROWSER)
    render(<MemoryRouter><DesktopAppCard /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Skrivbordsappen' })).toBeInTheDocument()
  })

  it('/ladda-ner: home in the shell, the card in a browser', () => {
    const at = (ua: string) => {
      as(ua)
      const { unmount } = render(
        <MemoryRouter initialEntries={['/ladda-ner']}>
          <Routes>
            <Route path="/ladda-ner" element={<DownloadRedirect />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>,
      )
      const where = screen.getByTestId('where').textContent
      unmount()
      return where
    }
    expect(at(SHELL)).toBe('/')
    expect(at(BROWSER)).toBe('/installningar#skrivbordsappen')
  })

  it('help: no download answer or button in the shell', () => {
    const view = viewOf(null)
    const action = downloadEntry.actions![0]
    as(SHELL)
    expect(entryVisible(downloadEntry, view)).toBe(false)
    expect(actionAllowed(action, null)).toBe(false)
    as(BROWSER)
    expect(entryVisible(downloadEntry, view)).toBe(true)
    expect(actionAllowed(action, null)).toBe(true)
  })
})
