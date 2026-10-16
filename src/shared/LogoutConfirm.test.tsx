import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LogoutConfirm } from './LogoutConfirm'

/** Samma koppling som sidomenyn: knappen öppnar frågan, "Ja" loggar ut. */
function Harness({ logout }: { logout: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Logga ut
      </button>
      {open && <LogoutConfirm onConfirm={logout} onCancel={() => setOpen(false)} />}
    </>
  )
}

describe('LogoutConfirm', () => {
  it('asks first and logs out only on "Ja, logga ut"', async () => {
    const user = userEvent.setup()
    const logout = vi.fn()
    render(<Harness logout={logout} />)

    await user.click(screen.getByRole('button', { name: 'Logga ut' }))
    expect(screen.getByRole('alertdialog', { name: 'Vill du logga ut?' })).toBeInTheDocument()
    expect(logout).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Ja, logga ut' }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('"Nej" closes the question, keeps the user signed in and returns focus', async () => {
    const user = userEvent.setup()
    const logout = vi.fn()
    render(<Harness logout={logout} />)
    const opener = screen.getByRole('button', { name: 'Logga ut' })

    await user.click(opener)
    expect(screen.getByRole('button', { name: 'Nej, stanna kvar' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Nej, stanna kvar' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(logout).not.toHaveBeenCalled()
    expect(opener).toHaveFocus()
  })

  it('Escape means no, and Tab stays inside the question', async () => {
    const user = userEvent.setup()
    const logout = vi.fn()
    render(<Harness logout={logout} />)

    await user.click(screen.getByRole('button', { name: 'Logga ut' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Ja, logga ut' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Nej, stanna kvar' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(logout).not.toHaveBeenCalled()
  })
})
