import { act, render, renderHook, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_CHANGED_EVENT } from './api'
import { LIVE_INTERVAL_MS, backoffMs, dedupe, useLiveForm, useLiveQuery, useLiveRefresh } from './live'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refetches every 15 s while the tab is visible', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useLiveRefresh(refetch))
    expect(refetch).not.toHaveBeenCalled()
    await tick(LIVE_INTERVAL_MS)
    expect(refetch).toHaveBeenCalledTimes(1)
    await tick(LIVE_INTERVAL_MS * 2)
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it('pauses while the tab is hidden and refetches at once when it is visible again', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useLiveRefresh(refetch))
    setVisibility('hidden')
    await tick(LIVE_INTERVAL_MS * 4)
    expect(refetch).not.toHaveBeenCalled()
    setVisibility('visible')
    await tick(0)
    expect(refetch).toHaveBeenCalledTimes(1)
    await tick(LIVE_INTERVAL_MS)
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('refetches on window focus (once when focus and visibility come together), online and after an own save', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useLiveRefresh(refetch))
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(refetch).toHaveBeenCalledTimes(1)
    await tick(2000)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(refetch).toHaveBeenCalledTimes(2)
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { path: '/x' } }))
    })
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it('backs off after failures and starts over after a success', async () => {
    expect(backoffMs(1)).toBe(30_000)
    expect(backoffMs(2)).toBe(60_000)
    expect(backoffMs(10)).toBe(5 * 60_000)
    const refetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(false) // false counts as a failure too
      .mockResolvedValue(undefined)
    renderHook(() => useLiveRefresh(refetch))
    await tick(LIVE_INTERVAL_MS) // fails: next in 30 s
    expect(refetch).toHaveBeenCalledTimes(1)
    await tick(LIVE_INTERVAL_MS)
    expect(refetch).toHaveBeenCalledTimes(1)
    await tick(LIVE_INTERVAL_MS) // 30 s: fails again, next in 60 s
    expect(refetch).toHaveBeenCalledTimes(2)
    await tick(LIVE_INTERVAL_MS * 3)
    expect(refetch).toHaveBeenCalledTimes(2)
    await tick(LIVE_INTERVAL_MS) // 60 s: works
    expect(refetch).toHaveBeenCalledTimes(3)
    await tick(LIVE_INTERVAL_MS) // back to every 15 s
    expect(refetch).toHaveBeenCalledTimes(4)
  })

  it('never runs two refetches at once', async () => {
    let finish: () => void = () => undefined
    const refetch = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    renderHook(() => useLiveRefresh(refetch))
    await tick(LIVE_INTERVAL_MS)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(refetch).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(refetch).toHaveBeenCalledTimes(2) // the 'online' that came meanwhile
    await act(async () => finish())
    await tick(LIVE_INTERVAL_MS)
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it('a save during a running refetch is not dropped: one more runs right after', async () => {
    const finishers: Array<() => void> = []
    const refetch = vi.fn(() => new Promise<void>((resolve) => { finishers.push(resolve) }))
    renderHook(() => useLiveRefresh(refetch))
    await tick(LIVE_INTERVAL_MS) // interval fetch starts (before the save)
    await act(async () => {
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT))
    })
    expect(refetch).toHaveBeenCalledTimes(1)
    await act(async () => finishers[0]())
    expect(refetch).toHaveBeenCalledTimes(2) // both signals become one more fetch
    await act(async () => finishers[1]())
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('stops when disabled or unmounted', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    const { rerender, unmount } = renderHook(({ on }) => useLiveRefresh(refetch, { enabled: on }), { initialProps: { on: false } })
    await tick(LIVE_INTERVAL_MS)
    expect(refetch).not.toHaveBeenCalled()
    rerender({ on: true })
    await tick(LIVE_INTERVAL_MS)
    expect(refetch).toHaveBeenCalledTimes(1)
    unmount()
    await tick(LIVE_INTERVAL_MS * 2)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('runs its own faster pace when asked (and still pauses when hidden)', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useLiveRefresh(refetch, { everyMs: 5000 }))
    await tick(15_000)
    expect(refetch).toHaveBeenCalledTimes(3)
    setVisibility('hidden')
    await tick(15_000)
    expect(refetch).toHaveBeenCalledTimes(3)
  })
})

describe('useLiveQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the same object when nothing changed, and swaps it when the server changed', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce([{ id: 1, price: 100 }])
      .mockResolvedValueOnce([{ id: 1, price: 100 }])
      .mockResolvedValueOnce([{ id: 1, price: 129 }])
    const { result } = renderHook(() => useLiveQuery('loc-1', fetcher))
    expect(result.current.loading).toBe(true)
    await tick(0)
    const first = result.current.data
    expect(first).toEqual([{ id: 1, price: 100 }])
    await tick(LIVE_INTERVAL_MS)
    expect(result.current.data).toBe(first)
    await tick(LIVE_INTERVAL_MS)
    expect(result.current.data).toEqual([{ id: 1, price: 129 }])
    expect(result.current.loading).toBe(false)
  })

  it('a quiet refetch that fails keeps the data and shows no error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(['a']).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useLiveQuery('k', fetcher))
    await tick(0)
    await tick(LIVE_INTERVAL_MS)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current.data).toEqual(['a'])
    expect(result.current.error).toBeUndefined()
  })

  it('an answer fetched before a local change does not overwrite it', async () => {
    let answer: (v: string[]) => void = () => undefined
    const fetcher = vi.fn()
      .mockResolvedValueOnce(['a'])
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { answer = resolve }))
    const { result } = renderHook(() => useLiveQuery('k', fetcher))
    await tick(0)
    await tick(LIVE_INTERVAL_MS) // a refetch starts
    act(() => result.current.setData(['a', 'mine']))
    await act(async () => answer(['a'])) // the older answer arrives last
    expect(result.current.data).toEqual(['a', 'mine'])
  })
})

describe('no clobbering an edit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // En lista som hämtas levande och ett formulär med sin egen kopia: listan
  // byts, det du skriver i står kvar (så är sidorna byggda).
  function Page({ fetcher }: { fetcher: () => Promise<{ name: string }> }) {
    const { data } = useLiveQuery('dish', fetcher)
    const [draft, setDraft] = useState<string | null>(null)
    return (
      <>
        <p>I listan: {data?.name}</p>
        {data && draft === null && <button onClick={() => setDraft(data.name)}>Ändra</button>}
        {draft !== null && <input aria-label="Namn" value={draft} onChange={(e) => setDraft(e.target.value)} />}
      </>
    )
  }

  it('the list follows the server while the form keeps what you typed', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ name: 'Torsk' }).mockResolvedValue({ name: 'Torskrygg' })
    render(<Page fetcher={fetcher} />)
    await tick(0)
    act(() => screen.getByRole('button', { name: 'Ändra' }).click())
    const input = screen.getByLabelText('Namn') as HTMLInputElement
    input.focus()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'Torsk med smör')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await tick(LIVE_INTERVAL_MS)
    expect(screen.getByText('I listan: Torskrygg')).toBeInTheDocument()
    expect(screen.getByLabelText('Namn')).toHaveValue('Torsk med smör')
    expect(document.activeElement).toBe(input)
  })
})

describe('useLiveForm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function Card({ fetch }: { fetch: () => Promise<string> }) {
    const [saved, setSaved] = useState('10')
    const [form, setForm] = useState('10')
    const live = useLiveForm<string, string>({
      enabled: true,
      fetch,
      saved,
      form,
      toForm: (v) => v,
      adopt: (v) => {
        setSaved(v)
        setForm(v)
      },
    })
    return (
      <>
        <input aria-label="Minuter" value={form} onChange={(e) => setForm(e.target.value)} />
        {live.there !== null && <p>Ändrades nyss: {live.there}</p>}
      </>
    )
  }

  it('what you type while the refetch is under way is kept', async () => {
    let answer: (v: string) => void = () => undefined
    const fetch = vi.fn(() => new Promise<string>((resolve) => { answer = resolve }))
    render(<Card fetch={fetch} />)
    await tick(LIVE_INTERVAL_MS) // the fetch is out, the form still untouched
    const input = screen.getByLabelText('Minuter') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '45')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => answer('20'))
    expect(screen.getByLabelText('Minuter')).toHaveValue('45')
    expect(screen.getByText('Ändrades nyss: 20')).toBeInTheDocument()
  })

  it('an untouched form follows the server', async () => {
    const fetch = vi.fn().mockResolvedValue('20')
    render(<Card fetch={fetch} />)
    await tick(LIVE_INTERVAL_MS)
    expect(screen.getByLabelText('Minuter')).toHaveValue('20')
    expect(screen.queryByText(/Ändrades nyss/)).toBeNull()
  })
})

describe('dedupe', () => {
  it('shares one request between callers until it settles', async () => {
    const fetch = vi.fn().mockResolvedValue(1)
    const [a, b] = await Promise.all([dedupe('x', fetch), dedupe('x', fetch)])
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await dedupe('x', fetch)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
