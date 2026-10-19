import { useSyncExternalStore } from 'react'

/**
 * Pågående skrivningar (spara, publicera, skicka ...). Varje anrop som
 * ändrar något räknas upp när det startar och ned när det är klart, och
 * BusyBar visar en strimma överst så länge något pågår. Alla sidor får det
 * gratis via apiFetch; en längre sak som inte går via API:t (uppladdning)
 * kan ringa start()/end() själv.
 */
let count = 0
let finishedAt = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function busyStart(): void {
  count += 1
  emit()
}

export function busyEnd(): void {
  count = Math.max(0, count - 1)
  if (count === 0) finishedAt = Date.now()
  emit()
}

/** Kör `work` som en pågående skrivning. */
export async function withBusy<T>(work: () => Promise<T>): Promise<T> {
  busyStart()
  try {
    return await work()
  } finally {
    busyEnd()
  }
}

export interface BusyState {
  active: boolean
  /** När den senaste skrivningen blev klar (för "klart"-skimret). */
  finishedAt: number
}

let snapshot: BusyState = { active: false, finishedAt: 0 }

function getSnapshot(): BusyState {
  if (snapshot.active !== count > 0 || snapshot.finishedAt !== finishedAt) {
    snapshot = { active: count > 0, finishedAt }
  }
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBusy(): BusyState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Endast för tester. */
export function resetBusyForTests(): void {
  count = 0
  finishedAt = 0
  emit()
}
