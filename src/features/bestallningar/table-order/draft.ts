import { TABLE_ORDER_DRAFT_KEY_PREFIX } from '../../../shared/storageRegistry'
import type { Course } from './types'
import type { CartLine } from './cart'

/**
 * The unsent cart, kept per location on this device so a waiter who is
 * interrupted (app closed, battery, a call) can pick up where they were
 * ("Fortsätt där du var"). Cleared on send. Also remembers the table
 * picker view (Karta or Lista). Never holds anything about payment.
 */

export const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

export type PickerView = 'karta' | 'lista'

export interface Draft {
  savedAt: number
  tableId: string | null
  tabId: string | null
  covers: number | null
  guestName: string
  lines: CartLine[]
  holds: Partial<Record<Course, boolean>>
}

interface Stored {
  v: 1
  view?: PickerView
  draft?: Draft
}

function key(locationId: string): string {
  return `${TABLE_ORDER_DRAFT_KEY_PREFIX}${locationId}`
}

function read(locationId: string): Stored {
  try {
    const raw = window.localStorage.getItem(key(locationId))
    if (!raw) return { v: 1 }
    const parsed = JSON.parse(raw) as Stored
    return parsed && parsed.v === 1 ? parsed : { v: 1 }
  } catch {
    return { v: 1 }
  }
}

function write(locationId: string, stored: Stored): void {
  try {
    if (!stored.view && !stored.draft) window.localStorage.removeItem(key(locationId))
    else window.localStorage.setItem(key(locationId), JSON.stringify(stored))
  } catch {
    /* private mode or full storage: the draft is a convenience */
  }
}

function validLine(l: unknown): l is CartLine {
  const line = l as CartLine
  return Boolean(line) && typeof line.key === 'string' && typeof line.menuItemId === 'string'
    && typeof line.name === 'string' && Number.isFinite(line.unitPrice) && Number.isInteger(line.quantity)
    && line.quantity > 0 && typeof line.course === 'string' && Array.isArray(line.options)
}

/** The saved draft, or null when there is none, it is empty or older than 12 hours. */
export function loadDraft(locationId: string, now = Date.now()): Draft | null {
  const draft = read(locationId).draft
  if (!draft || !Array.isArray(draft.lines)) return null
  if (now - draft.savedAt > DRAFT_MAX_AGE_MS) {
    clearDraft(locationId)
    return null
  }
  const lines = draft.lines.filter(validLine)
  if (lines.length === 0) return null
  return { ...draft, lines }
}

export function saveDraft(locationId: string, draft: Omit<Draft, 'savedAt'>, now = Date.now()): void {
  const stored = read(locationId)
  if (draft.lines.length === 0) {
    delete stored.draft
  } else {
    stored.draft = { ...draft, savedAt: now }
  }
  write(locationId, stored)
}

export function clearDraft(locationId: string): void {
  const stored = read(locationId)
  delete stored.draft
  write(locationId, stored)
}

/** The saved Karta/Lista choice; `fallback` when none was made on this device. */
export function loadPickerView(locationId: string, fallback: PickerView = 'karta'): PickerView {
  const view = read(locationId).view
  return view === 'lista' || view === 'karta' ? view : fallback
}

export function savePickerView(locationId: string, view: PickerView): void {
  write(locationId, { ...read(locationId), view })
}
