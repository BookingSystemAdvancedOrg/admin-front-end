/**
 * Varje sida laddas först när den öppnas, så att första laddningen bara
 * hämtar skalet och den sida man står på. preloadPages() hämtar resten i
 * bakgrunden när webbläsaren är ledig, så att sidbyten ändå är omedelbara.
 */
export const pages = {
  oversikt: () => import('./features/oversikt/OversiktPage'),
  bokningar: () => import('./features/bokningar/BokningarPage'),
  bestallningar: () => import('./features/bestallningar/BestallningarPage'),
  meny: () => import('./features/meny/MenyPage'),
  cateringkalkyl: () => import('./features/cateringkalkyl/CateringkalkylPage'),
  catering: () => import('./features/catering/CateringPage'),
  cateringRequest: () => import('./features/catering/CateringRequestPage'),
  layout: () => import('./features/layout-editor/LayoutEditorPage'),
  installningar: () => import('./features/installningar/InstallningarPage'),
  hjalp: () => import('./features/guide/HjalpPage'),
  marknadsforing: () => import('./features/marknadsforing/MarknadsforingPage'),
  statistik: () => import('./features/statistik/StatistikPage'),
  avtal: () => import('./features/dpa/AvtalPage'),
  tabetalt: () => import('./features/tabetalt/TaBetaltPage'),
  kassa: () => import('./features/kassa/KassaPage'),
  kassaGuide: () => import('./features/kassa/KassaGuide'),
  personal: () => import('./features/personal/PersonalPage'),
  personalliggare: () => import('./features/personalliggare/PersonalliggarePage'),
  gaster: () => import('./features/guest-crm/GasterPage'),
  presentkort: () => import('./features/gift-cards/PresentkortPage'),
  webbplats: () => import('./features/site-builder/WebbplatsPage'),
  telefon: () => import('./features/phone-agent/TelefonPage'),
  evenemang: () => import('./features/events-tickets/EvenemangPage'),
}

let preloaded = false
/** Hämtar alla sidor i bakgrunden, en gång, när webbläsaren har tid över. */
export function preloadPages() {
  if (preloaded || typeof window === 'undefined') return
  preloaded = true
  const run = () => {
    for (const load of Object.values(pages)) void load().catch(() => {})
  }
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (idle) idle(run, { timeout: 3000 })
  else setTimeout(run, 1500)
}
