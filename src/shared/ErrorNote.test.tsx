import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { ErrorNote } from './ErrorNote'
import { errorText } from './errors'

describe('ErrorNote', () => {
  it('Booqys fel: Försök igen och Rapportera till Booqy, med kvitto', async () => {
    const text = errorText(new ApiError(500, 'boom', { fromServer: true }), 'Kunde inte spara.')
    const retry = vi.fn()
    render(<MemoryRouter><ErrorNote text={text} onRetry={retry} /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Felet ligger hos Booqy')
    fireEvent.click(screen.getByRole('button', { name: /Försök igen/ }))
    expect(retry).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Rapportera till Booqy/ }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Booqy har fått rapporten'), { timeout: 2000 })
    expect(screen.queryByRole('button', { name: /Rapportera/ })).toBeNull()
  })

  it('användarens fel med en plats: en länk dit, ingen rapportknapp', () => {
    const text = errorText(new ApiError(403, 'dpa_version_outdated', { fromServer: true }))
    render(<MemoryRouter><ErrorNote text={text} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Öppna Avtal/ })).toHaveAttribute('href', '/avtal')
    expect(screen.queryByRole('button', { name: /Rapportera/ })).toBeNull()
  })

  it('en sidas egen text visas som förut', () => {
    render(<ErrorNote text="Fyll i namn." />)
    expect(screen.getByRole('alert').tagName).toBe('P')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('ingenting utan text', () => {
    const { container } = render(<ErrorNote text={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
