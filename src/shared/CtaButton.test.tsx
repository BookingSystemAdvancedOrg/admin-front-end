import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CtaButton } from './CtaButton'
import { Icon } from './Icon'

describe('CtaButton', () => {
  it('drops the win phrase after a click until the pointer leaves', () => {
    const onClick = vi.fn()
    render(<CtaButton label="Spara ändringar" win="Klart!" onClick={onClick} />)
    const button = screen.getByRole('button', { name: /Spara ändringar/ })
    expect(button.className).not.toContain('is-clicked')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    // "Klart!" must not look like the answer to a save that may have failed.
    expect(button.className).toContain('is-clicked')
    fireEvent.pointerLeave(button)
    expect(button.className).not.toContain('is-clicked')
  })

  it('shows a plus instead of the paper plane for add buttons (Meny, Lägg till rätt)', () => {
    const plus = render(<Icon name="plus" />).container.querySelector('svg')!.innerHTML
    const { container, rerender } = render(<CtaButton label="Lägg till rätt" icon="plus" />)
    const svg = () => container.querySelector('.cta-plane svg')!.innerHTML
    expect(svg()).toBe(plus)
    expect(container.querySelector('button')!.className).toContain('cta-turn')
    rerender(<CtaButton label="Skicka" />)
    expect(svg()).not.toBe(plus)
    expect(container.querySelector('button')!.className).not.toContain('cta-turn')
  })
})
