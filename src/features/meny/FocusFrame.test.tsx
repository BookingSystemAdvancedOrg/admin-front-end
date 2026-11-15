import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FocusFrame } from './FocusFrame'
import { CENTRE } from './imageFocus'
import type { ImageFocus } from './imageFocus'

function Harness({ onOpen }: { onOpen: () => void }) {
  const [focus, setFocus] = useState<ImageFocus>(CENTRE)
  return <FocusFrame src="https://cdn.example/a.webp" alt="Toast Skagen" focus={focus} onChange={setFocus} onOpen={onOpen} />
}

describe('FocusFrame', () => {
  it('arrow keys nudge the crop and Enter opens the large view', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    const frame = screen.getByRole('group', { name: /Bildens fokus: mitten/ })
    const img = screen.getByRole('img', { name: 'Toast Skagen' })
    frame.focus()
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(img).toHaveStyle({ objectPosition: '48% 48%' })
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}')
    expect(img).toHaveStyle({ objectPosition: '58% 48%' })
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a click without dragging opens the large view', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} />)
    await user.click(screen.getByRole('group'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
