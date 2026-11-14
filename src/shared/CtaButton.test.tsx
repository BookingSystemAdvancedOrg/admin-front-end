import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CtaButton } from './CtaButton'

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
})
