import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { hasUnsaved, useUnsavedGuard } from './unsaved'

let setDirty: (v: boolean) => void = () => {}
function Page() {
  const [dirty, set] = useState(false)
  setDirty = set
  useUnsavedGuard(dirty)
  return null
}

describe('useUnsavedGuard', () => {
  it('reports unsaved changes while a page is dirty, and forgets it when the page goes', () => {
    const view = render(<Page />)
    expect(hasUnsaved()).toBe(false)
    act(() => setDirty(true))
    expect(hasUnsaved()).toBe(true)
    act(() => setDirty(false))
    expect(hasUnsaved()).toBe(false)
    act(() => setDirty(true))
    view.unmount()
    expect(hasUnsaved()).toBe(false)
  })

  it('reads a function only when asked', () => {
    let dirty = false
    function Editor() {
      useUnsavedGuard(() => dirty)
      return null
    }
    render(<Editor />)
    expect(hasUnsaved()).toBe(false)
    dirty = true
    expect(hasUnsaved()).toBe(true)
  })
})
