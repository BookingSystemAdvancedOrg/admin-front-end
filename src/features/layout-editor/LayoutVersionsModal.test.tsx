import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as layoutApi from './layoutApi'
import { LayoutVersionsModal } from './LayoutVersionsModal'
import { earliestDate } from './versionTimeline'
import type { LayoutElement, PublishedLayoutSnapshot } from './layoutApi'

vi.mock('./layoutApi', async () => {
  const actual = await vi.importActual<typeof import('./layoutApi')>('./layoutApi')
  return {
    ...actual,
    loadLayoutVersions: vi.fn(),
    archiveLayoutVersion: vi.fn(),
    activateLayoutVersion: vi.fn(),
    cancelPendingLayoutActivation: vi.fn(),
  }
})

const tables = [4, 4, 2, 2].map((seats) => ({ type: 'table', seats }) as LayoutElement)
const version = (n: number, o: Partial<PublishedLayoutSnapshot> = {}): PublishedLayoutSnapshot => ({
  version: n, label: `Version ${n}`, isCurrent: false, effectiveFrom: null, effectiveTo: null, expiresAt: null,
  elements: tables, createdBy: 'a', createdAt: '2026-11-01T10:00:00Z', updatedBy: 'a', updatedAt: '2026-11-01T10:00:00Z', ...o,
})
const list = (items: PublishedLayoutSnapshot[]) => ({ items, earliestChangeDate: '2099-12-10', bookingHorizonDays: 21 })

// Like the owner's screenshot: 1 current, 2 waiting, 3-5 saved (API order: newest first).
const SCREENSHOT = [
  version(5), version(4), version(3),
  version(2, { effectiveFrom: '2099-12-16T23:00:00Z' }),
  version(1, { isCurrent: true, effectiveFrom: '2026-10-01T00:00:00Z', effectiveTo: '2099-12-16T23:00:00Z' }),
]

beforeEach(() => {
  vi.mocked(layoutApi.loadLayoutVersions).mockReset().mockResolvedValue(list(SCREENSHOT))
  vi.mocked(layoutApi.archiveLayoutVersion).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(layoutApi.cancelPendingLayoutActivation).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(layoutApi.activateLayoutVersion).mockReset().mockResolvedValue({
    status: 'pending', version: 5, currentVersion: 1, cutoverAt: '2099-12-09T23:00:00Z',
  })
})

const open = () => render(<LayoutVersionsModal locationId="loc-1" canActivate onClose={vi.fn()} onActivated={vi.fn()} />)

describe('LayoutVersionsModal timeline', () => {
  it('lists what applies now, then what comes next, then the rest, in plain words', async () => {
    open()
    const names = (await screen.findAllByText(/^Version \d$/)).map((el) => el.textContent)
    expect(names).toEqual(['Version 1', 'Version 2', 'Version 5', 'Version 4', 'Version 3'])
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nu gäller Version 1. Version 2 tar över av sig själv 17 december 2099',
    )
    expect(screen.getAllByText(/4 bord, 12 platser/)).toHaveLength(5)
    expect(screen.getByText('Gäller nu')).toBeInTheDocument()
    expect(screen.getByText('Från 17 dec. 2099')).toBeInTheDocument()
  })

  it('offers the earliest allowed date with the reason', async () => {
    const user = userEvent.setup()
    open()
    const [pick] = await screen.findAllByRole('button', { name: 'Välj datum för bytet' })
    await user.click(pick)
    expect(screen.getByLabelText('Version 5 tar över')).toHaveValue('10/12/2099')
    expect(screen.getByText(/Tidigast 10 december 2099/)).toBeInTheDocument()
    expect(screen.getByText('Bytet till Version 2 17 dec. 2099 stoppas.')).toBeInTheDocument()
  })

  it('replacing the waiting switch asks first, then stops it and books the new date', async () => {
    const user = userEvent.setup()
    open()
    const [pick] = await screen.findAllByRole('button', { name: 'Välj datum för bytet' })
    await user.click(pick)
    await user.click(screen.getByRole('button', { name: 'Byt 10 dec. 2099' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Byta ut Version 2?' })
    await user.click(within(dialog).getByRole('button', { name: 'Ja, Version 5' }))
    expect(layoutApi.cancelPendingLayoutActivation).toHaveBeenCalledWith('loc-1')
    expect(layoutApi.activateLayoutVersion).toHaveBeenCalledWith('loc-1', 5, '2099-12-10')
    expect(await screen.findByText('Klart. Version 5 tar över 10 december 2099.')).toBeInTheDocument()
  })

  it('removes a saved version only after the Booqy confirm box', async () => {
    const user = userEvent.setup()
    const native = vi.spyOn(window, 'confirm')
    open()
    const [remove] = await screen.findAllByRole('button', { name: 'Ta bort' })
    await user.click(remove)
    expect(native).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Ta bort Version 5?' })
    await user.click(within(dialog).getByRole('button', { name: 'Avbryt' }))
    expect(layoutApi.archiveLayoutVersion).not.toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'Ta bort' })[0])
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ta bort' }))
    expect(layoutApi.archiveLayoutVersion).toHaveBeenCalledWith('loc-1', 5)
    native.mockRestore()
  })

  it('with nothing current, a version is used at once', async () => {
    const user = userEvent.setup()
    vi.mocked(layoutApi.loadLayoutVersions).mockResolvedValue(list([version(1)]))
    vi.mocked(layoutApi.activateLayoutVersion).mockResolvedValue({ status: 'active', version: 1, effectiveFrom: '2026-11-18T10:00:00Z' })
    open()
    await user.click(await screen.findByRole('button', { name: 'Använd nu' }))
    expect(layoutApi.activateLayoutVersion).toHaveBeenCalledWith('loc-1', 1)
    expect(await screen.findByText('Version 1 gäller nu.')).toBeInTheDocument()
  })
})

describe('earliestDate', () => {
  it('uses the API date, else today + booking horizon + 1 day', () => {
    expect(earliestDate({ earliestChangeDate: '2026-12-10', bookingHorizonDays: 21 })).toBe('2026-12-10')
    expect(earliestDate({ earliestChangeDate: null, bookingHorizonDays: 21 }, new Date('2026-11-18T11:00:00Z'))).toBe('2026-12-10')
  })
})
