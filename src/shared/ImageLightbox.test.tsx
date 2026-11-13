import { useEffect, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ImageLightbox } from './ImageLightbox'

function Harness({ onUnderEscape = () => {} }: { onUnderEscape?: () => void }) {
  const [open, setOpen] = useState(false)
  // som DishModal: en dialog under som också lyssnar på Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onUnderEscape()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onUnderEscape])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Visa
      </button>
      {open && <ImageLightbox src="https://cdn.example/a.webp" alt="Toast Skagen" onClose={() => setOpen(false)} />}
    </>
  )
}

describe('ImageLightbox', () => {
  it('shows the image large with the dish name as alt text and focuses close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Visa' }))
    const dialog = screen.getByRole('dialog', { name: 'Toast Skagen' })
    expect(dialog.parentElement?.parentElement).toBe(document.body)
    expect(dialog.parentElement).toHaveClass('modal-overlay')
    expect(screen.getByRole('img', { name: 'Toast Skagen' })).toHaveAttribute('src', 'https://cdn.example/a.webp')
    expect(screen.getByRole('button', { name: 'Stäng bilden' })).toHaveFocus()
  })

  it('closes on Esc without closing a dialog under it, and returns focus', async () => {
    const user = userEvent.setup()
    const under = vi.fn()
    render(<Harness onUnderEscape={under} />)
    const opener = screen.getByRole('button', { name: 'Visa' })
    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(under).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
  })

  it('closes on the backdrop and the close button, not on the image', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Visa' }))
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('img') })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('dialog').parentElement! })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Visa' }))
    await user.click(screen.getByRole('button', { name: 'Stäng bilden' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Visa' }))
    const close = screen.getByRole('button', { name: 'Stäng bilden' })
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
  })
})
