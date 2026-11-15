import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AdminTopbar } from './AdminTopbar'

vi.mock('./location', () => ({ useLocationSummary: () => null }))

describe('AdminTopbar tools', () => {
  it('has Hjälp, the click sound and the theme toggle next to each other on every page', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AdminTopbar title="Bokningar" subtitle="Sole" actions={<button type="button">Ny bokning</button>} />
      </MemoryRouter>,
    )
    const group = screen.getByRole('group', { name: 'Hjälp, ljud och utseende' })
    expect(screen.getByRole('link', { name: 'Hjälp' })).toHaveAttribute('href', '/hjalp')
    const sound = screen.getByRole('button', { name: 'Klickljud' })
    const theme = screen.getByRole('button', { name: /läge, byt till/ })
    expect(group).toContainElement(sound)
    expect(group).toContainElement(theme)

    const pressed = sound.getAttribute('aria-pressed')
    await user.click(sound)
    expect(sound.getAttribute('aria-pressed')).not.toBe(pressed)

    const before = document.documentElement.dataset.theme
    await user.click(theme)
    const after = document.documentElement.dataset.theme
    expect(after).not.toBe(before)
    expect(localStorage.getItem('booqy-theme')).toBe(after)
  })
})
