import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useConfirm } from './ConfirmDialog'

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const [el, ask] = useConfirm()
  return (
    <>
      <button type="button" onClick={async () => onResult(await ask({ title: 'Ta bort rätten?', confirmLabel: 'Ta bort' }))}>
        Öppna
      </button>
      {el}
    </>
  )
}

describe('useConfirm', () => {
  it('resolves true on confirm and false on Escape', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    await user.click(screen.getByRole('button', { name: 'Öppna' }))
    expect(screen.getByRole('alertdialog', { name: 'Ta bort rätten?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avbryt' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Ta bort' }))
    expect(onResult).toHaveBeenLastCalledWith(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Öppna' }))
    await user.keyboard('{Escape}')
    expect(onResult).toHaveBeenLastCalledWith(false)
  })
})
