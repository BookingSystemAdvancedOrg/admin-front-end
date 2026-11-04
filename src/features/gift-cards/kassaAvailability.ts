/**
 * Tar Kassan emot presentkort? Inte än: kontrollsystemet saknar betalsättet
 * (Run 0 `ControlSystem.voucher_method = None`, Kassan svarar 501
 * `gift_card_receipt_not_supported`). Knappen döljs tills det är beslutat,
 * och döljs också resten av sessionen om Kassan svarar 501.
 */
export const KASSA_ACCEPTS_GIFT_CARDS = false
let kassaRefused = false

export function markKassaRefused(): void {
  kassaRefused = true
}

export function kassaGiftCardsAvailable(): boolean {
  return KASSA_ACCEPTS_GIFT_CARDS && !kassaRefused
}

/** For tests. */
export function resetKassaRefusedForTests(): void {
  kassaRefused = false
}
