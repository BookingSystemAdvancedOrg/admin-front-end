import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import SegmentAudienceOptions from './SegmentAudienceOptions'
import * as api from './api'

vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  listSegments: vi.fn(),
  exportSegment: vi.fn(),
}))

function Host({ seen }: { seen: (v: unknown) => void }) {
  const [value, setValue] = useState<{ type: 'segment'; exportId: string } | null>(null)
  return <SegmentAudienceOptions value={value} onChange={(v) => { seen(v); setValue(v) }} />
}

describe('SegmentAudienceOptions', () => {
  it('reuses the export already made for a segment instead of a new one per dropdown change', async () => {
    vi.mocked(api.listSegments).mockResolvedValue({
      segments: [{ segmentId: 's1', name: 'Stamgäster' }, { segmentId: 's2', name: 'Nya' }] as unknown as api.Segment[],
      templates: [],
    } as never)
    let n = 0
    vi.mocked(api.exportSegment).mockImplementation(async (segmentId) => ({ exportId: `e-${segmentId}-${++n}`, count: 7 }) as never)
    const seen = vi.fn()
    render(<Host seen={seen} />)
    const select = await screen.findByRole('combobox')
    for (const id of ['s1', 's2', 's1', 's2', 's1']) {
      fireEvent.change(select, { target: { value: id } })
      await waitFor(() => expect(select).not.toBeDisabled())
    }
    expect(api.exportSegment).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenLastCalledWith({ type: 'segment', exportId: 'e-s1-1' })
    expect(screen.getByText('7 gäster kan få utskicket.')).toBeInTheDocument()
    fireEvent.change(select, { target: { value: '' } })
    expect(seen).toHaveBeenLastCalledWith(null)
  })
})
