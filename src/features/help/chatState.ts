import { useSyncExternalStore } from 'react'

/** Öppna assistenten utifrån (kommandopaletten, Kom igång) och veta om den är på. */

export const OPEN_EVENT = 'booqy:help-chat'
let enabledNow = false
const listeners = new Set<() => void>()

/**
 * Det man frågar om, t.ex. ett steg i Kom igång. Assistenten visar det
 * överst, föreslår frågorna och skickar `label` med varje fråga så att
 * svaret handlar om just det steget.
 */
export type HelpContext = { key: string; label: string; questions: string[] }

export function openHelpChat(context?: HelpContext) {
  window.dispatchEvent(new CustomEvent<HelpContext | undefined>(OPEN_EVENT, { detail: context }))
}

/** Är assistenten på för restaurangen just nu? (paletten visar då åtgärden) */
export function helpChatEnabled(): boolean {
  return enabledNow
}

export function setHelpChatEnabled(on: boolean) {
  if (enabledNow === on) return
  enabledNow = on
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Samma sak som en hook: Fråga-knapparna i Kom igång syns bara när assistenten är på. */
export function useHelpChatEnabled(): boolean {
  return useSyncExternalStore(subscribe, helpChatEnabled, () => false)
}

/**
 * Frågan som skickas: stegets namn först, så att både servern och
 * kunskapsbasen i webbläsaren svarar om rätt steg (servern tar bara emot
 * frågan och historiken). Användaren ser bara sin egen fråga.
 */
export function withContext(question: string, context: Pick<HelpContext, 'label'> | null): string {
  if (!context) return question
  return `Kom igång, ${context.label}: ${question}`.slice(0, 500)
}
