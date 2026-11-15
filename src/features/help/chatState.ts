/** Öppna assistenten utifrån (kommandopaletten) och veta om den är på. */

export const OPEN_EVENT = 'booqy:help-chat'
let enabledNow = false

export function openHelpChat() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

/** Är assistenten på för restaurangen just nu? (paletten visar då åtgärden) */
export function helpChatEnabled(): boolean {
  return enabledNow
}

export function setHelpChatEnabled(on: boolean) {
  enabledNow = on
}
