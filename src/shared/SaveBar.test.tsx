import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SaveBar } from './SaveBar'
import { useDirtyForm } from './dirtyForm'
import { hasUnsaved } from './unsaved'

function Form({ onSave = () => {} }: { onSave?: () => void }) {
  const [saved, setSaved] = useState({ closes: '22:00', ranges: ['11:00'] })
  const [value, setValue] = useState(saved)
  const dirty = useDirtyForm(value, saved)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
        setSaved(value)
      }}
    >
      <label htmlFor="closes">Stänger</label>
      <input id="closes" value={value.closes} onChange={(e) => setValue({ ...value, closes: e.target.value })} />
      <button type="button" onClick={() => setValue({ ...value, ranges: [...value.ranges, '17:00'] })}>Lägg till tid</button>
      <SaveBar dirty={dirty} onDiscard={() => setValue(saved)} />
    </form>
  )
}

const save = () => screen.getByRole('button', { name: 'Spara' })

describe('SaveBar', () => {
  it('is disabled while the form is clean', () => {
    render(<Form />)
    expect(save()).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Ångra ändringar' })).toBeNull()
    expect(hasUnsaved()).toBe(false)
  })

  it('is enabled after an edit and disabled again after reverting it', () => {
    render(<Form />)
    const input = screen.getByLabelText('Stänger')
    fireEvent.change(input, { target: { value: '23:00' } })
    expect(save()).toBeEnabled()
    expect(hasUnsaved()).toBe(true)
    fireEvent.change(input, { target: { value: '22:00' } })
    expect(save()).toBeDisabled()
    expect(hasUnsaved()).toBe(false)
  })

  it('counts an added row as a change, and Ångra ändringar resets it', () => {
    render(<Form />)
    fireEvent.click(screen.getByRole('button', { name: 'Lägg till tid' }))
    expect(save()).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Ångra ändringar' }))
    expect(save()).toBeDisabled()
  })

  it('sticks to the bottom of the screen while there are unsaved changes (smoke)', () => {
    render(<Form />)
    expect(screen.getByTestId('save-bar')).not.toHaveClass('save-bar--dirty')
    fireEvent.change(screen.getByLabelText('Stänger'), { target: { value: '23:00' } })
    expect(screen.getByTestId('save-bar')).toHaveClass('save-bar--dirty')
    expect(screen.getByText('Osparade ändringar')).toBeInTheDocument()
  })

  it('saves and is clean again after a successful save', () => {
    const onSave = vi.fn()
    render(<Form onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Stänger'), { target: { value: '23:00' } })
    fireEvent.click(save())
    expect(onSave).toHaveBeenCalledOnce()
    expect(save()).toBeDisabled()
  })

  it('offers Spara igen after a failed save', () => {
    render(<SaveBar dirty failed />)
    expect(screen.getByRole('button', { name: 'Spara igen' })).toBeEnabled()
  })
})
