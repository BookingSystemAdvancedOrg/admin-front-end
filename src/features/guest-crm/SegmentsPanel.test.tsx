import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SegmentsPanel from './SegmentsPanel'
import * as api from './api'

vi.mock('../../shared/tenant', () => ({
  useTenant: () => ({ tenant: { role: 'owner_user', entitlements: { maxLocations: null, features: { guestCrm: true } }, locations: [] } }),
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  listSegments: vi.fn(),
}))

describe('SegmentsPanel', () => {
  it('lists saved segments as stacked rows with the actions beside the text, not a two-column settings grid', async () => {
    vi.mocked(api.listSegments).mockResolvedValue({
      segments: [{ segmentId: 's1', name: 'Stamgäster', rules: { minVisits: 5 }, version: 1 } as unknown as api.Segment],
      templates: [],
    })
    render(<SegmentsPanel />)
    const row = (await screen.findByText('Stamgäster')).closest('li')!
    expect(row.closest('ul')).toHaveClass('gaster-segments')
    expect(row).not.toHaveClass('settings-row')
    expect(row).toContainElement(screen.getByRole('button', { name: 'Ändra' }))
  })
})
