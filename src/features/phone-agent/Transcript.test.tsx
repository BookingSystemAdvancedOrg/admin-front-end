import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Transcript } from './Transcript'
import { TRANSLATE_WAIT_MS, translationState } from './transcriptText'
import type { Turn } from './api'
import { CALL_TEXT_VIEW_KEY_PREFIX } from '../../shared/storageRegistry'

const KEY = `${CALL_TEXT_VIEW_KEY_PREFIX}user-1`
const AR = 'أريد حجز طاولة لشخصين.'

function turns(over: Partial<Turn> = {}): Turn[] {
  return [
    { role: 'agent', lang: 'sv', text: 'Hej, du talar med Booqy.', textEn: 'Hi, you are speaking with Booqy.', translation: 'done', at: '2026-11-18T18:00:00Z' },
    { role: 'tool', text: 'hold_table', toolName: 'hold_table', toolOk: true, at: '2026-11-18T18:00:05Z' },
    { role: 'caller', lang: 'ar', asrLocale: 'ar_AE', text: AR, textSv: 'Jag vill boka ett bord för två.',
      textEn: 'I would like to book a table for two.', translation: 'done', at: '2026-11-18T18:00:10Z', ...over },
  ]
}

type Call = { outcome: string | null; startedAt: string; durationSec: number }
/** Slutade för en minut sedan. */
const ENDED: Call = { outcome: 'booked', startedAt: new Date(Date.now() - 3 * 60_000).toISOString(), durationSec: 120 }

function show(list: Turn[] = turns(), call: Call = ENDED) {
  render(<Transcript turns={list} call={call} userKey="user-1" />)
  return within(screen.getByRole('tabpanel', { name: 'Utskrift' }))
}

beforeEach(() => {
  localStorage.clear()
})

describe('Transcript', () => {
  it('shows Swedish by default and switches to the original and English', () => {
    const panel = show()
    expect(screen.getByRole('tab', { name: 'Svenska' })).toHaveAttribute('aria-selected', 'true')
    expect(panel.getByText('Jag vill boka ett bord för två.')).toBeInTheDocument()
    expect(panel.getByText('Hej, du talar med Booqy.')).toBeInTheDocument()   // already Swedish: the original
    expect(panel.queryByText('hold_table')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
    expect(panel.getByText(AR)).toBeInTheDocument()
    expect(panel.queryByText('Jag vill boka ett bord för två.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'English' }))
    expect(panel.getByText('I would like to book a table for two.')).toBeInTheDocument()
    expect(panel.getByText('Hi, you are speaking with Booqy.')).toBeInTheDocument()
  })

  it('remembers the choice per user and starts from it next time', () => {
    show()
    fireEvent.click(screen.getByRole('tab', { name: 'English' }))
    expect(localStorage.getItem(KEY)).toBe('en')
  })

  it('opens on the remembered choice', () => {
    localStorage.setItem(KEY, 'original')
    const panel = show()
    expect(screen.getByRole('tab', { name: 'Original' })).toHaveAttribute('aria-selected', 'true')
    expect(panel.getByText(AR)).toBeInTheDocument()
  })

  it('still works when storage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    show()
    fireEvent.click(screen.getByRole('tab', { name: 'English' }))
    expect(screen.getByText('I would like to book a table for two.')).toBeInTheDocument()
    get.mockRestore()
    set.mockRestore()
  })

  it('puts a language chip on turns that were not in Swedish', () => {
    const panel = show()
    const items = panel.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).queryByText('Arabiska')).not.toBeInTheDocument()
    expect(within(items[1]).getByText('Arabiska')).toBeInTheDocument()
  })

  it('shows the original with the printing note while the translation is pending', () => {
    const panel = show(turns({ textSv: undefined, textEn: undefined, translation: 'pending' }))
    expect(panel.getByText(AR)).toBeInTheDocument()
    expect(panel.getByRole('status')).toHaveTextContent('Översätter…')
    fireEvent.click(screen.getByRole('tab', { name: 'Original' }))
    expect(panel.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no translating note while the call is still going on', () => {
    const panel = show(turns({ textSv: undefined, textEn: undefined, translation: 'pending' }), { ...ENDED, outcome: null })
    expect(panel.getByText(AR)).toBeInTheDocument()
    expect(panel.queryByRole('status')).not.toBeInTheDocument()
    expect(panel.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the original and says it is Booqy\'s fault, with refetch and report, when the translation failed', () => {
    const panel = show(turns({ textSv: undefined, textEn: undefined, translation: 'failed' }))
    expect(panel.getByText(AR)).toBeInTheDocument()
    expect(panel.getByRole('alert')).toHaveTextContent(/Utskriften kunde inte översättas\. Felet ligger hos Booqy/)
    expect(panel.getByRole('button', { name: 'Rapportera till Booqy' })).toBeInTheDocument()
    // Försök igen hämtar om sidan (servern försöker själv igen); inget eget omförsök
    expect(panel.getByRole('button', { name: 'Försök igen' })).toBeInTheDocument()
  })

  it('counts a translation still pending long after the call as failed', () => {
    const long = { outcome: 'booked', startedAt: '2026-11-18T18:00:00Z', durationSec: 60 }
    const pending = turns({ translation: 'pending' })
    const end = Date.parse(long.startedAt) + 60_000
    expect(translationState(pending, long, end + 1000)).toBe('pending')
    expect(translationState(pending, long, end + TRANSLATE_WAIT_MS + 1000)).toBe('failed')
    expect(translationState(pending, { ...long, outcome: null }, end + TRANSLATE_WAIT_MS + 1000)).toBe('none')
    expect(translationState(turns(), long, end)).toBe('none')
  })
})

describe('mock calls (no API)', () => {
  it('has an Arabic and a German call; the German one is still translating at first', async () => {
    const api = await import('./api')
    api.resetPhoneMock()
    const { calls } = await api.listCalls('mock-location', '2026-11-12', '2026-11-18')
    expect(calls.map((c) => c.language).sort()).toEqual(['ar', 'de'])
    const ar = await api.getCall('mock-location', 'mock-call-ar')
    expect(ar.turns.some((t) => t.lang === 'ar' && t.textSv && t.textEn)).toBe(true)
    const first = await api.getCall('mock-location', 'mock-call-de')
    expect(first.turns.every((t) => t.translation === 'pending' && !t.textSv)).toBe(true)
    api.resetPhoneMock({ deTranslatedAt: 0 })
    const next = await api.getCall('mock-location', 'mock-call-de')
    expect(next.turns.some((t) => t.lang === 'de' && t.textSv)).toBe(true)
  })
})
