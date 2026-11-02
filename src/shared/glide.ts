/**
 * Den valda fliken glider, som flikarna "Boka bord · Beställ mat · Catering ·
 * Kassa" på booqy.se: varje väljare där man väljer ett av flera får ett
 * sandfärgat spår och en espressofärgad pill (::before) som glider och
 * sträcker sig till det valda alternativet i stället för att hoppa.
 *
 * Sidorna ritar sina knappar som vanligt; det här mäter dem bara och sätter
 * data-glide och --glide-x/-y/-w/-h på behållaren (React rör aldrig de
 * attributen). En behållare blir en glidare när den har minst två val och
 * ett av dem är valt, så verktygsgrupper utan valt läge (ångra, zoom) och
 * ensamma av/på-knappar lämnas i fred. Stilen finns sist i brand.css.
 */

/**
 * Väljarna; 'track' = sandspår som på booqy.se, 'bare' = bara pillen.
 * 'always' = blir en glidare direkt, även innan något är valt (snabbval).
 */
const GROUPS: [string, 'track' | 'bare', 'always'?][] = [
  ['.settings-nav .settings-tabs', 'bare'],
  ['.mk-tabs', 'track'],
  ['.mk-segment', 'track'],
  ['.sk-chips', 'track'],
  ['.segmented', 'track'],
  ['.kassa-switch', 'track'],
  ['.kassa-cats', 'track'],
  ['.floor-tabs', 'track'],
  ['.view-toggle', 'track'],
  ['.shape-toggle', 'track'],
  ['.floor-list', 'track'],
  ['.pay-mode', 'track'],
  ['.kassa-chips', 'track', 'always'],
]

const ACTIVE = ".active, .on, [aria-pressed='true'], [aria-selected='true'], [aria-checked='true']"

function place(bar: HTMLElement, kind: 'track' | 'bare', always?: 'always') {
  const items = Array.from(bar.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.matches('button, a'))
  const on = items.find((c) => c.matches(ACTIVE))
  // en lägg till-knapp (+) i gruppen är en handling, inte ett val
  const options = items.filter((c) => !c.matches('.add'))
  if (!bar.dataset.glide) {
    if (options.length < 2 || (!on && !always)) return
    bar.dataset.glide = kind
  }
  if (!on || !on.getClientRects().length) {
    delete bar.dataset.glideOn
    return
  }
  // Layoutmåtten, inte getBoundingClientRect: tryckkänslan krymper knappen en
  // stund (scale), och då skulle pillen först sikta på den mindre knappen och
  // sedan rycka om. offsetLeft/-Top räknas från spårets kant och följer med
  // när spåret rullar, precis som pillen.
  bar.style.setProperty('--glide-x', `${on.offsetLeft}px`)
  bar.style.setProperty('--glide-y', `${on.offsetTop}px`)
  bar.style.setProperty('--glide-w', `${on.offsetWidth}px`)
  bar.style.setProperty('--glide-h', `${on.offsetHeight}px`)
  if (bar.dataset.glideOn === undefined) {
    // första gången landar pillen på plats utan att glida in från kanten
    bar.dataset.glideOn = ''
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.dataset.glidePlaced = ''
    }))
  }
}

let queued = false
function placeAll() {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    for (const [selector, kind, always] of GROUPS) {
      document.querySelectorAll<HTMLElement>(selector).forEach((bar) => place(bar, kind, always))
    }
  })
}

let installed = false

/** Lyssnar en gång på sidan; varje väljare som dyker upp eller byter val placeras om. */
export function installGlide() {
  if (installed || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  installed = true
  new MutationObserver(placeAll).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'aria-checked'],
  })
  window.addEventListener('resize', placeAll)
  void document.fonts?.ready.then(placeAll)
  placeAll()
}
