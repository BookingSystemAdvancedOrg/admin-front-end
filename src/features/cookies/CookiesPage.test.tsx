import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import CookiesPage from './CookiesPage'
import { STORAGE_REGISTRY } from '../../shared/storageRegistry'

describe('CookiesPage', () => {
  it('lists every registry entry, so the page matches what the code stores', () => {
    render(
      <MemoryRouter>
        <CookiesPage />
      </MemoryRouter>,
    )
    for (const entry of STORAGE_REGISTRY) {
      expect(screen.getByText(entry.name)).toBeInTheDocument()
      expect(screen.getByText(entry.purpose)).toBeInTheDocument()
    }
    expect(screen.getByText(/inga cookies för statistik eller marknadsföring/)).toBeInTheDocument()
  })
})
