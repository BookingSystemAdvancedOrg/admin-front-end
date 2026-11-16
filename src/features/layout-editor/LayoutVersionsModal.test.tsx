import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as layoutApi from './layoutApi'
import { LayoutVersionsModal } from './LayoutVersionsModal'
import type { PublishedLayoutSnapshot } from './layoutApi'

vi.mock('./layoutApi', async () => {
  const actual = await vi.importActual<typeof import('./layoutApi')>('./layoutApi')
  return { ...actual, listLayoutVersions: vi.fn(), archiveLayoutVersion: vi.fn() }
})

const version = (n: number, isCurrent: boolean): PublishedLayoutSnapshot => ({
  version: n, label: `Version ${n}`, isCurrent, effectiveFrom: null, effectiveTo: null, expiresAt: null,
  elements: [], createdBy: 'a', createdAt: '2026-11-01T10:00:00Z', updatedBy: 'a', updatedAt: '2026-11-01T10:00:00Z',
})

beforeEach(() => {
  vi.mocked(layoutApi.listLayoutVersions).mockResolvedValue([version(2, true), version(1, false)])
  vi.mocked(layoutApi.archiveLayoutVersion).mockReset().mockResolvedValue(undefined as never)
})

describe('LayoutVersionsModal archive', () => {
  it('asks in the Booqy confirm box, not the browser one', async () => {
    const user = userEvent.setup()
    const native = vi.spyOn(window, 'confirm')
    render(<LayoutVersionsModal locationId="loc-1" canActivate onClose={vi.fn()} onActivated={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Arkivera' }))
    expect(native).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Arkivera Version 1?' })
    await user.click(screen.getByRole('button', { name: 'Avbryt' }))
    expect(dialog).not.toBeInTheDocument()
    expect(layoutApi.archiveLayoutVersion).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Arkivera' }))
    const confirm = screen.getAllByRole('button', { name: 'Arkivera' }).find((b) => b.closest('[role="alertdialog"]'))!
    await user.click(confirm)
    expect(layoutApi.archiveLayoutVersion).toHaveBeenCalledWith('loc-1', 1)
    native.mockRestore()
  })
})
