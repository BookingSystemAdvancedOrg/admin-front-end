/**
 * Var en rullista (shared/Select.tsx) öppen när det senaste trycket började?
 * Då stängde trycket bara listan, och klicket som följer ska inte göra något
 * mer (till exempel öppna raden under listan). Lyssnaren sitter på window i
 * capture-fasen, så den hinner före rullistans egen (på document), som
 * stänger listan redan vid trycket.
 */
let openAtPress = false

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    () => {
      openAtPress = document.querySelector('.b-select-layer') !== null
    },
    true,
  )
}

export function pressClosedSelect(): boolean {
  return openAtPress
}
