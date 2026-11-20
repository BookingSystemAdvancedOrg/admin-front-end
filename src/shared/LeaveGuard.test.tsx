import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LeaveGuard } from './LeaveGuard'
import { useUnsavedGuard } from './unsaved'

function Editor() {
  const [text, setText] = useState('')
  useUnsavedGuard(text !== '')
  return (
    <>
      <input aria-label="Namn" value={text} onChange={(e) => setText(e.target.value)} />
      <Link to="/meny">Meny</Link>
    </>
  )
}

function App() {
  return (
    <MemoryRouter initialEntries={['/installningar']}>
      <LeaveGuard />
      <Routes>
        <Route path="/installningar" element={<Editor />} />
        <Route path="/meny" element={<h1>Menysidan</h1>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LeaveGuard', () => {
  it('lets a clean page go without asking', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Meny' }))
    expect(screen.getByRole('heading', { name: 'Menysidan' })).toBeInTheDocument()
  })

  it('asks before leaving unsaved changes, and stays or leaves as chosen', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Namn'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('link', { name: 'Meny' }))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stanna kvar' }))
    expect(screen.getByLabelText('Namn')).toHaveValue('x')
    fireEvent.click(screen.getByRole('link', { name: 'Meny' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lämna utan att spara' }))
    expect(screen.getByRole('heading', { name: 'Menysidan' })).toBeInTheDocument()
  })
})
