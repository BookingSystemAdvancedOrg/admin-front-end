import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DesktopHint } from './DesktopHint'

const setUa = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })

afterEach(() => {
  localStorage.clear()
})

describe('tipset om skrivbordsappen', () => {
  it('visas aldrig i skrivbordsappen, inte heller utan glas', () => {
    setUa('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 BooqyDesktop/1.3.0 BooqyGlass/none')
    const { container } = render(<DesktopHint />)
    expect(container.querySelector('.admin-app-hint')).toBeNull()
  })

  it('står i flödet i en webbläsare på en dator tills man stänger det', () => {
    setUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15')
    const first = render(<DesktopHint />)
    expect(first.container.querySelector('.admin-app-hint')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stäng tipset' }))
    expect(first.container.querySelector('.admin-app-hint')).toBeNull()
    first.unmount()
    const again = render(<DesktopHint />)
    expect(again.container.querySelector('.admin-app-hint')).toBeNull()
  })
})
