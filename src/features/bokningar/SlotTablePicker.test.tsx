import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../../shared/api'
import { testPlan } from '../../test/layout'
import { chooseOption } from '../../test/select'
import { SLOT_REFRESH_MS, SlotTablePicker } from './SlotTablePicker'
import type { SlotValue } from './SlotTablePicker'
import { dayNotice } from './bookingsApi'

const getAvailability = vi.fn()
vi.mock('./bookingsApi', async (orig) => ({
  ...(await orig<typeof import('./bookingsApi')>()),
  getAvailability: (...a: unknown[]) => getAvailability(...a),
}))
const loadActiveLayout = vi.fn()
const loadVersionPlans = vi.fn()
vi.mock('../layout-editor/activeLayout', async (orig) => ({
  ...(await orig<typeof import('../layout-editor/activeLayout')>()),
  loadActiveLayout: (...a: unknown[]) => loadActiveLayout(...a),
  loadVersionPlans: (...a: unknown[]) => loadVersionPlans(...a),
}))

const TODAY = '2026-10-12'

// Bord 1-3 numrerade som på gästsajten (ritningens ordning); id:na visas aldrig.
const PLAN = testPlan([
  { id: 'a-uuid', seats: 2 },
  { id: 'b-uuid', seats: 4 },
  { id: 'c-uuid', seats: 6 },
])

const slot = (startTime: string, tables: [string, number][]) => ({
  startTime,
  endTime: '20:00',
  layoutVersion: 1,
  tables: tables.map(([tableId, seats]) => ({ tableId, seats })),
})

function picker(startTime = '18:00') {
  return render(
    <SlotTablePicker
      locationId="loc-1"
      date={TODAY}
      startTime={startTime}
      tableIds={[]}
      partySize={2}
      today={TODAY}
      onChange={() => {}}
    />,
  )
}

/** Väljaren med eget state, som formulären har. */
function Host({
  start = { startTime: '18:00', tableIds: [] },
  partySize = 2,
  keep,
  onChange,
  locationId = 'loc-1',
}: {
  start?: { startTime: string; tableIds: string[] }
  partySize?: number
  keep?: { date: string; startTime: string; tableIds: string[]; seats?: number }
  onChange?: (v: SlotValue) => void
  locationId?: string
}) {
  const [v, setV] = useState<SlotValue>({ date: TODAY, ...start })
  return (
    <SlotTablePicker
      locationId={locationId}
      date={v.date}
      startTime={v.startTime}
      tableIds={v.tableIds}
      partySize={partySize}
      today={TODAY}
      keep={keep}
      onChange={(next) => {
        setV(next)
        onChange?.(next)
      }}
    />
  )
}

const table = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  getAvailability.mockReset()
  loadActiveLayout.mockReset()
  loadActiveLayout.mockResolvedValue(PLAN)
  loadVersionPlans.mockReset()
  loadVersionPlans.mockResolvedValue({ current: 1, plans: new Map([[1, PLAN]]) })
})

const TWO_FLOORS = () =>
  testPlan(
    [
      { id: 'a-uuid', seats: 2, floor: 'f1' },
      { id: 'b-uuid', seats: 4, floor: 'f2' },
    ],
    [
      { floorId: 'f1', name: 'Entréplan', level: 0 },
      { floorId: 'f2', name: 'Terrass', level: 1 },
    ],
  )

describe('SlotTablePicker', () => {
  it('draws the layout as a 2D map: free tables to pick, the rest taken, numbered like the guest site', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['b-uuid', 4], ['a-uuid', 2]])], day: null })
    picker()
    const map = await screen.findByRole('group', { name: 'Bordskarta' })
    expect(within(map).getByRole('group', { name: 'Bord på Entréplan' })).toBeInTheDocument()
    expect(table(/^Bord 1, 2 pl, ledigt$/)).not.toHaveAttribute('aria-disabled')
    expect(table(/^Bord 2, 4 pl, ledigt$/)).toHaveAttribute('aria-pressed', 'false')
    const taken = table(/^Bord 3, 6 pl, upptaget$/)
    expect(taken).toHaveAttribute('aria-disabled', 'true')
    expect(taken).toHaveClass('is-full')
    // Alla bord går att nå med tabb, också de upptagna.
    for (const t of within(map).getAllByRole('button')) expect(t).toHaveAttribute('tabindex', '0')
    expect(screen.getByText('Ledigt')).toBeInTheDocument()
    expect(screen.getByText('Valt')).toBeInTheDocument()
    expect(screen.getByText('Upptaget')).toBeInTheDocument()
    expect(screen.getByText('Inget bord valt')).toBeInTheDocument()
    expect(screen.queryByText(/uuid/)).toBeNull()
    // Ingen lista med kryssrutor, bara kartan.
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(document.querySelector('.table-chips')).toBeNull()
    // Alla tidens bord finns i kartan: inga versioner hämtas.
    expect(loadVersionPlans).not.toHaveBeenCalled()
  })

  it('shows no map before a time is chosen', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    picker('')
    await screen.findByText('Välj tid')
    expect(screen.queryByRole('group', { name: 'Bordskarta' })).toBeNull()
  })

  it('toggles one or several tables and names them, with the seats line', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2], ['b-uuid', 4]])], day: null })
    render(<Host partySize={5} onChange={onChange} />)
    await user.click(await screen.findByRole('button', { name: /^Bord 1,/ }))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '18:00', tableIds: ['a-uuid'] })
    expect(table(/^Bord 1, 2 pl, valt$/)).toHaveAttribute('aria-pressed', 'true')
    expect(table(/^Bord 1,/)).toHaveClass('is-selected')
    expect(screen.getByText('Valda bord har 2 platser - sällskapet är 5.')).toHaveClass('form-error')

    await user.click(table(/^Bord 2,/))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '18:00', tableIds: ['a-uuid', 'b-uuid'] })
    expect(screen.getByText('Bord 1, 2')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Valda bord har 6 platser.')).toBeInTheDocument()

    await user.click(table(/^Bord 1,/))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '18:00', tableIds: ['b-uuid'] })
    expect(screen.getByText('Bord 2')).toBeInTheDocument()
  })

  it('picks with Enter and Space from the keyboard', async () => {
    const onChange = vi.fn()
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2], ['b-uuid', 4]])], day: null })
    render(<Host onChange={onChange} />)
    fireEvent.keyDown(await screen.findByRole('button', { name: /^Bord 2,/ }), { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '18:00', tableIds: ['b-uuid'] })
    fireEvent.keyDown(table(/^Bord 1,/), { key: ' ' })
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '18:00', tableIds: ['b-uuid', 'a-uuid'] })
  })

  it('a taken table cannot be picked by click, its tap area or the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    render(<Host onChange={onChange} />)
    const taken = await screen.findByRole('button', { name: /^Bord 3, 6 pl, upptaget$/ })
    await user.click(taken)
    fireEvent.keyDown(taken, { key: 'Enter' })
    fireEvent.click(document.querySelector('.floor-map-hit[data-table="c-uuid"]')!)
    expect(onChange).not.toHaveBeenCalled()
    expect(document.querySelector('.floor-map-hit[data-table="c-uuid"]')).toHaveClass('is-full')
  })

  it('says when no table is free at that time', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [])], day: null })
    picker()
    expect(await screen.findByText('Inga lediga bord den tiden.')).toBeInTheDocument()
    expect(table(/^Bord 1, 2 pl, upptaget$/)).toHaveAttribute('aria-disabled', 'true')
  })

  it('ignores a free table that is not in the layout or in any version', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2], ['gone-uuid', 8]])], day: null })
    picker()
    const map = await screen.findByRole('group', { name: 'Bord på Entréplan' })
    expect(within(map).getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByText(/gone/)).toBeNull()
    expect(loadVersionPlans).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Ny bordskarta från den här dagen.')).toBeNull()
  })

  it('draws the layout version of the time after a scheduled layout switch', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // Dagens karta har bara a-uuid; version 5 (från ett senare datum) har new-uuid.
    loadActiveLayout.mockResolvedValue(testPlan([{ id: 'a-uuid', seats: 2 }]))
    const next = testPlan([{ id: 'new-uuid', seats: 6 }, { id: 'a-uuid', seats: 2 }])
    loadVersionPlans.mockResolvedValue({ current: 4, plans: new Map([[5, next]]) })
    getAvailability.mockResolvedValue({ slots: [{ ...slot('18:00', [['new-uuid', 6]]), layoutVersion: 5 }], day: null })
    render(<Host partySize={4} onChange={onChange} />)
    expect(await screen.findByText('Ny bordskarta från den här dagen.')).toBeInTheDocument()
    expect(screen.queryByText('Inga lediga bord den tiden.')).toBeNull()
    await user.click(table(/^Bord 1, 6 pl, ledigt$/))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '18:00', tableIds: ['new-uuid'] })
    expect(table(/^Bord 2, 2 pl, upptaget$/)).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Valda bord har 6 platser.')).toBeInTheDocument()
    expect(loadVersionPlans).toHaveBeenCalledWith('loc-1')
  })

  it("lists an own table that is not on the map under it, and it can be removed", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // Bokningen står på ett bord som bara finns i en väntande version, och versionerna går inte att hämta.
    loadVersionPlans.mockRejectedValue(new NetworkError())
    getAvailability.mockResolvedValue({ slots: [slot('19:00', [['a-uuid', 2], ['b-uuid', 4]])], day: null })
    render(
      <Host
        start={{ startTime: '19:00', tableIds: ['gone-uuid'] }}
        keep={{ date: TODAY, startTime: '19:00', tableIds: ['gone-uuid'], seats: 4 }}
        onChange={onChange}
      />,
    )
    const off = await screen.findByRole('list', { name: 'Bord utanför kartan' })
    await user.click(table(/^Bord 2, 4 pl, ledigt$/))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '19:00', tableIds: ['gone-uuid', 'b-uuid'] })
    expect(screen.getByText('Bord 2, borttaget bord')).toBeInTheDocument()
    await user.click(within(off).getByRole('button', { name: 'Ta bort borttaget bord' }))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '19:00', tableIds: ['b-uuid'] })
    expect(screen.queryByRole('list', { name: 'Bord utanför kartan' })).toBeNull()
    expect(screen.getByText('Bord 2')).toBeInTheDocument()
  })

  it('keeps the floor when its last chosen table is unticked', async () => {
    const user = userEvent.setup()
    loadActiveLayout.mockResolvedValue(TWO_FLOORS())
    getAvailability.mockResolvedValue({ slots: [slot('19:00', [['a-uuid', 2]])], day: null })
    render(
      <Host
        start={{ startTime: '19:00', tableIds: ['b-uuid'] }}
        keep={{ date: TODAY, startTime: '19:00', tableIds: ['b-uuid'], seats: 4 }}
      />,
    )
    const terrace = await screen.findByRole('tab', { name: 'Terrass, valda bord' })
    expect(terrace).toHaveAttribute('aria-selected', 'true')
    const own = table(/^Bord 2, 4 pl, valt$/)
    own.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('tab', { name: 'Terrass' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('group', { name: 'Bord på Terrass' })).toBeInTheDocument()
    expect(table(/^Bord 2, 4 pl, ledigt$/)).toHaveFocus()
    expect(screen.getByText('Inget bord valt')).toBeInTheDocument()
  })

  it('a table taken during the minute refresh is unticked, explained and shown as taken', async () => {
    vi.useFakeTimers()
    try {
      getAvailability
        .mockResolvedValueOnce({ slots: [slot('18:00', [['a-uuid', 2], ['b-uuid', 4]])], day: null })
        .mockResolvedValue({ slots: [slot('18:00', [['b-uuid', 4]])], day: null })
      render(<Host start={{ startTime: '18:00', tableIds: ['a-uuid', 'b-uuid'] }} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(table(/^Bord 1, 2 pl, valt$/)).toBeInTheDocument()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOT_REFRESH_MS)
      })
      expect(screen.getByRole('status')).toHaveTextContent('Ett valt bord har hunnit bokas - välj bord igen.')
      expect(table(/^Bord 1, 2 pl, upptaget$/)).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText('Bord 2')).toHaveAttribute('aria-live', 'polite')
      expect(loadActiveLayout).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads the layout again for another location', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    const { rerender } = render(<Host />)
    await screen.findByRole('button', { name: /^Bord 1, 2 pl, ledigt$/ })
    loadActiveLayout.mockResolvedValue(testPlan([{ id: 'a-uuid', seats: 2, label: 'Bar' }]))
    rerender(<Host locationId="loc-2" />)
    expect(await screen.findByRole('button', { name: /^Bar, 2 pl, ledigt$/ })).toBeInTheDocument()
    expect(loadActiveLayout).toHaveBeenCalledTimes(2)
    expect(loadActiveLayout).toHaveBeenLastCalledWith('loc-2')
  })

  it('shows one floor at a time with tabs that mark the floors holding chosen tables', async () => {
    const user = userEvent.setup()
    loadActiveLayout.mockResolvedValue(
      testPlan(
        [
          { id: 'a-uuid', seats: 2, floor: 'f1' },
          { id: 'b-uuid', seats: 4, floor: 'f2' },
          { id: 'c-uuid', seats: 6, floor: 'f2' },
        ],
        [
          { floorId: 'f1', name: 'Entréplan', level: 0 },
          { floorId: 'f2', name: 'Terrass', level: 1 },
        ],
      ),
    )
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2], ['b-uuid', 4], ['c-uuid', 6]])], day: null })
    render(<Host />)
    const tabs = await screen.findByRole('tablist', { name: 'Våning' })
    expect(within(tabs).getByRole('tab', { name: 'Entréplan' })).toHaveAttribute('aria-selected', 'true')
    expect(table(/^Bord 1,/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Bord 2,/ })).toBeNull()

    await user.click(within(tabs).getByRole('tab', { name: 'Terrass' }))
    expect(screen.getByRole('group', { name: 'Bord på Terrass' })).toBeInTheDocument()
    // numbered across floors, like the guest site
    await user.click(table(/^Bord 3, 6 pl, ledigt$/))
    const terrace = within(tabs).getByRole('tab', { name: 'Terrass, valda bord' })
    expect(terrace).toHaveClass('has-selected')
    expect(within(tabs).getByRole('tab', { name: 'Entréplan' })).not.toHaveClass('has-selected')
    expect(screen.getByText('Bord 3')).toBeInTheDocument()
  })

  it('opens on the floor of the chosen tables', async () => {
    loadActiveLayout.mockResolvedValue(
      testPlan(
        [
          { id: 'a-uuid', seats: 2, floor: 'f1' },
          { id: 'b-uuid', seats: 4, floor: 'f2' },
        ],
        [
          { floorId: 'f1', name: 'Entréplan', level: 0 },
          { floorId: 'f2', name: 'Terrass', level: 1 },
        ],
      ),
    )
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2], ['b-uuid', 4]])], day: null })
    render(<Host start={{ startTime: '18:00', tableIds: ['b-uuid'] }} />)
    expect(await screen.findByRole('tab', { name: 'Terrass, valda bord' })).toHaveAttribute('aria-selected', 'true')
    expect(table(/^Bord 2, 4 pl, valt$/)).toBeInTheDocument()
  })

  it("counts an edited booking's own tables as free for it, with their seats", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // Bord 2 och 3 är bokningens egna: servern visar dem inte som lediga.
    getAvailability.mockResolvedValue({ slots: [slot('19:00', [['a-uuid', 2]])], day: null })
    render(
      <Host
        start={{ startTime: '19:00', tableIds: ['b-uuid', 'c-uuid'] }}
        keep={{ date: TODAY, startTime: '19:00', tableIds: ['b-uuid', 'c-uuid'], seats: 10 }}
        onChange={onChange}
      />,
    )
    expect(await screen.findByRole('button', { name: /^Bord 2, 4 pl, valt$/ })).not.toHaveAttribute('aria-disabled')
    expect(table(/^Bord 3, 6 pl, valt$/)).toBeInTheDocument()
    expect(screen.getByText('Valda bord har 10 platser.')).toBeInTheDocument()
    await user.click(table(/^Bord 3,/))
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, startTime: '19:00', tableIds: ['b-uuid'] })
    expect(table(/^Bord 3, 6 pl, ledigt$/)).not.toHaveAttribute('aria-disabled')
    expect(screen.getByText('Valda bord har 4 platser.')).toBeInTheDocument()
  })

  it('loads the layout once per location, not for every time', async () => {
    getAvailability.mockResolvedValue({
      slots: [slot('18:00', [['a-uuid', 2]]), slot('18:30', [['b-uuid', 4]])],
      day: null,
    })
    render(<Host />)
    await screen.findByRole('button', { name: /^Bord 1, 2 pl, ledigt$/ })
    chooseOption(screen.getByLabelText('Tid'), '18:30')
    expect(await screen.findByRole('button', { name: /^Bord 2, 4 pl, ledigt$/ })).toBeInTheDocument()
    expect(table(/^Bord 1, 2 pl, upptaget$/)).toBeInTheDocument()
    expect(loadActiveLayout).toHaveBeenCalledTimes(1)
    expect(loadActiveLayout).toHaveBeenCalledWith('loc-1')
  })

  it('prints the receipt while the map loads', async () => {
    loadActiveLayout.mockReturnValue(new Promise(() => {}))
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    picker()
    expect(await screen.findByText('Hämtar bordskartan…')).toBeInTheDocument()
  })

  it('a map that does not load is Booqys fault and Försök igen loads it again', async () => {
    const user = userEvent.setup()
    loadActiveLayout.mockRejectedValueOnce(new ApiError(503, 'layout_unavailable', { fromServer: true }))
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    picker()
    expect(await screen.findByText(/^Bordskartan kunde inte visas\./)).toBeInTheDocument()
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Försök igen' }))
    expect(await screen.findByRole('button', { name: /^Bord 1, 2 pl, ledigt$/ })).toBeInTheDocument()
    expect(loadActiveLayout).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/^Bordskartan kunde inte visas\./)).toBeNull()
  })

  it('a map that does not load without a connection offers Försök igen, and tries again each minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      loadActiveLayout.mockRejectedValueOnce(new NetworkError()).mockRejectedValueOnce(new NetworkError())
      getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
      picker()
      expect(await screen.findByText(/^Vi når inte Booqy just nu/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Rapportera till Booqy' })).toBeNull()
      // Varje minut hämtas kartan igen medan felet står kvar.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOT_REFRESH_MS)
      })
      expect(loadActiveLayout).toHaveBeenCalledTimes(2)
      expect(screen.getByText(/^Vi når inte Booqy just nu/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Försök igen' }))
      expect(await screen.findByRole('button', { name: /^Bord 1, 2 pl, ledigt$/ })).toBeInTheDocument()
      expect(loadActiveLayout).toHaveBeenCalledTimes(3)
      expect(screen.queryByRole('button', { name: 'Försök igen' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a map that failed loads again when the connection is back', async () => {
    loadActiveLayout.mockRejectedValueOnce(new NetworkError())
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    picker()
    await screen.findByText(/^Vi når inte Booqy just nu/)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByRole('button', { name: /^Bord 1, 2 pl, ledigt$/ })).toBeInTheDocument()
    expect(loadActiveLayout).toHaveBeenCalledTimes(2)
  })

  it('without a published layout there are no tables: a note points to Layout, no list', async () => {
    loadActiveLayout.mockResolvedValue(null)
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['a-uuid', 2]])], day: null })
    picker()
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Ingen bordskarta än. Publicera en layout under Layout.')
    expect(within(note).getByRole('link', { name: 'Layout' })).toHaveAttribute('href', '/layout')
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    expect(screen.queryByRole('button', { name: /^Bord / })).toBeNull()
  })

  it('explains a closed day instead of just "no times"', async () => {
    getAvailability.mockResolvedValue({ slots: [], day: { kind: 'closed', note: 'Privat fest' } })
    picker('')
    expect(await screen.findByText('Restaurangen är stängd den dagen (Privat fest).')).toBeInTheDocument()
  })

  it('lets staff pick today through today + 21, as the server allows', async () => {
    getAvailability.mockResolvedValue({ slots: [], day: null })
    picker('')
    const field = await screen.findByLabelText('Datum')
    expect(field).toHaveAttribute('data-min', TODAY)
    expect(field).toHaveAttribute('data-max', '2026-11-02')
  })

  it('tells staff they can still book on a day without online booking', async () => {
    getAvailability.mockResolvedValue({ slots: [], day: { kind: 'no_online' } })
    picker('')
    expect(await screen.findByText(/Onlinebokningen är stängd den dagen - här kan du ändå boka/)).toBeInTheDocument()
  })
})

describe('dayNotice', () => {
  it('describes each kind of special day', () => {
    expect(dayNotice(null)).toBeNull()
    expect(dayNotice({ kind: 'hours', intervals: [{ opensAt: '11:00', closesAt: '14:00' },
      { opensAt: '17:00', closesAt: '22:00' }] })).toBe(
      'Avvikande öppettider den dagen: 11:00-14:00, 17:00-22:00.',
    )
  })

  it('shows a table too small for the party as not selectable while a roomy table is free', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['b-uuid', 4], ['a-uuid', 2]])], day: null })
    const { rerender } = render(
      <SlotTablePicker locationId="loc-1" date={TODAY} startTime="18:00" tableIds={[]} partySize={4} today={TODAY} onChange={() => {}} />,
    )
    await screen.findByRole('group', { name: 'Bordskarta' })
    expect(table(/^Bord 1, 2 pl, för litet$/)).toHaveAttribute('aria-disabled', 'true')
    expect(table(/^Bord 2, 4 pl, ledigt$/)).not.toHaveAttribute('aria-disabled')
    // Ett större sällskap än något enskilt bord: borden får slås ihop.
    rerender(<SlotTablePicker locationId="loc-1" date={TODAY} startTime="18:00" tableIds={[]} partySize={6} today={TODAY} onChange={() => {}} />)
    expect(table(/^Bord 1, 2 pl, ledigt$/)).not.toHaveAttribute('aria-disabled')
  })

  it('keeps every other table pickable when the booking already has tables, and explains the rule when it applies', async () => {
    getAvailability.mockResolvedValue({ slots: [slot('18:00', [['b-uuid', 4], ['a-uuid', 2]])], day: null })
    const { rerender } = render(
      <SlotTablePicker locationId="loc-1" date={TODAY} startTime="18:00" tableIds={[]} partySize={4} today={TODAY} onChange={() => {}} />,
    )
    await screen.findByRole('group', { name: 'Bordskarta' })
    expect(screen.getByText('Ett ledigt bord rymmer sällskapet. Välj det först.')).toBeInTheDocument()
    // Redigering: bokningens eget bord är förvalt, då går de andra att välja (och slå ihop).
    rerender(<SlotTablePicker locationId="loc-1" date={TODAY} startTime="18:00" tableIds={['a-uuid']} partySize={6} today={TODAY} onChange={() => {}} />)
    expect(table(/^Bord 2, 4 pl, ledigt$/)).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText('Ett ledigt bord rymmer sällskapet. Välj det först.')).toBeNull()
  })
})
