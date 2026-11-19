import { beforeEach, describe, expect, it } from 'vitest'
import { TABLE_ORDER_DRAFT_KEY_PREFIX } from '../../../shared/storageRegistry'
import type { CartLine } from './cart'
import { clearDraft, DRAFT_MAX_AGE_MS, loadDraft, loadPickerView, saveDraft, savePickerView } from './draft'

const line: CartLine = {
  key: 'm-skagen~~~~starters', menuItemId: 'm-skagen', name: 'Toast Skagen', unitPrice: 16500, quantity: 2,
  options: [], course: 'starters', stationId: 'kok', stationName: 'Kök',
}

const draft = { tableId: 'mock-t5', tabId: null, covers: 2, guestName: 'Lisa', lines: [line], holds: { mains: true } }

beforeEach(() => localStorage.clear())

describe('table order draft', () => {
  it('keeps the unsent cart per location under the registered key', () => {
    saveDraft('loc-1', draft, 1000)
    expect(localStorage.getItem(`${TABLE_ORDER_DRAFT_KEY_PREFIX}loc-1`)).toContain('Toast Skagen')
    expect(loadDraft('loc-1', 2000)).toMatchObject({ tableId: 'mock-t5', covers: 2, guestName: 'Lisa', lines: [line] })
    expect(loadDraft('loc-2', 2000)).toBeNull()
  })

  it('forgets a draft older than 12 hours', () => {
    saveDraft('loc-1', draft, 0)
    expect(loadDraft('loc-1', DRAFT_MAX_AGE_MS + 1)).toBeNull()
    expect(localStorage.getItem(`${TABLE_ORDER_DRAFT_KEY_PREFIX}loc-1`)).toBeNull()
  })

  it('clears on send but keeps the Karta/Lista choice', () => {
    savePickerView('loc-1', 'lista')
    saveDraft('loc-1', draft)
    clearDraft('loc-1')
    expect(loadDraft('loc-1')).toBeNull()
    expect(loadPickerView('loc-1')).toBe('lista')
  })

  it('an empty cart removes the draft', () => {
    saveDraft('loc-1', draft)
    saveDraft('loc-1', { ...draft, lines: [] })
    expect(loadDraft('loc-1')).toBeNull()
  })

  it('drops broken lines and survives broken storage', () => {
    localStorage.setItem(`${TABLE_ORDER_DRAFT_KEY_PREFIX}loc-1`, JSON.stringify({ v: 1, draft: { ...draft, savedAt: Date.now(), lines: [line, { name: 'x' }] } }))
    expect(loadDraft('loc-1')?.lines).toEqual([line])
    localStorage.setItem(`${TABLE_ORDER_DRAFT_KEY_PREFIX}loc-1`, '{not json')
    expect(loadDraft('loc-1')).toBeNull()
    expect(loadPickerView('loc-1', 'lista')).toBe('lista')
  })

  it('uses the fallback view until a choice is made', () => {
    expect(loadPickerView('loc-1')).toBe('karta')
    expect(loadPickerView('loc-1', 'lista')).toBe('lista')
    savePickerView('loc-1', 'karta')
    expect(loadPickerView('loc-1', 'lista')).toBe('karta')
  })
})
