/**
 * Allt som admin-appen sparar i webbläsaren, på ett ställe.
 *
 * Det här är facit: koden hämtar sina nyckelnamn härifrån, sidan
 * /cookies ritar sin tabell härifrån, och ett test (storageRegistry.test.ts)
 * underkänner kod som skriver till lagring utan att gå via den här filen.
 * Lägger du till något: lägg till det här först.
 *
 * Samtyckesbanner: behövs inte. Allt nedan är strikt nödvändigt för att
 * leverera tjänsten användaren bett om (inloggning, val hen själv gjort),
 * vilket är undantaget i lagen om elektronisk kommunikation 9 kap. 28 §.
 * Lägger någon till analys- eller marknadsföringslagring måste det här
 * omprövas först: då krävs samtycke innan något sådant sätts.
 */

import { STORAGE_KEYS } from './contracts'

export type StorageKind = 'cookie' | 'localStorage' | 'sessionStorage' | 'IndexedDB'
export type StorageCategory = 'nödvändig' | 'funktionell' | 'analys' | 'marknadsföring'

export interface StorageEntry {
  /** Namnet i webbläsaren; {x} står för en del som varierar. */
  name: string
  kind: StorageKind
  setBy: string
  purpose: string
  lifetime: string
  category: StorageCategory
}

export const REFRESH_COOKIE = '__Secure-booqy_rt'
export const LOCATION_KEY_PREFIX = 'admin-location-id:'
export const LEGACY_LOCATION_KEY = 'admin-location-id'
export const GUIDE_KEY_PREFIX = 'booqy-guide-done:'
export const LEGACY_SESSION_KEY = 'admin-auth-session'
export const MOCK_SESSION_KEY = 'admin-mock-session'
export const LOGOUT_PENDING_KEY = 'booqy-logout-pending'
export const MOTION_SEEN_KEY = 'booqy-motion-seen'
export const THEME_KEY = 'booqy-theme'
export const APP_HINT_KEY = 'booqy-app-hint'
export const GLASS_BACKDROP_KEY = 'booqy-glass-backdrop'
export const SOUND_KEY = 'booqy-sound'
export const SOUND_VOLUME_KEY = 'booqy-sound-volume'
/** Ljudet för nya onlinebeställningar på den här enheten (shared/orderAlert). */
export const ORDER_SOUND_KEY = 'booqy-order-sound'
/** Beställningslarmets sedda id:n och öppna ruta, för en omladdning i samma flik. */
export const ORDER_ALERT_KEY = 'booqy-order-alert'
/** Cateringlarmets sedda id:n och öppna ruta, för en omladdning i samma flik. */
export const CATERING_ALERT_KEY = 'booqy-catering-alert'
/** Cateringförfrågningar som en flik redan har larmat om, delat mellan flikarna (per plats). */
export const CATERING_PINGED_KEY_PREFIX = 'booqy-catering-pinged:'
export const NAV_CLOSED_KEY = 'booqy-nav-closed'
export const SAMPLE_DATA_KEY = 'booqy-sample-data'
export const STATISTIK_OPEN_KEY_PREFIX = 'booqy-statistik-open:'
export const UPDATED_FLAG_KEY = 'booqy-updated'
export const CALL_TEXT_VIEW_KEY_PREFIX = 'booqy-samtal-sprak:'
/** Bordsbeställningens osända rätter och vyn Karta/Lista, per plats. */
export const TABLE_ORDER_DRAFT_KEY_PREFIX = 'booqy-bordsbestallning:'
/** IndexedDB-databasen för insläpp vid dörren, en per tillfälle (CONTRACTS.md 10). */
export const EVENT_SCAN_KEY_PREFIX = STORAGE_KEYS.EVENT_SCAN_KEY_PREFIX

export const STORAGE_REGISTRY: readonly StorageEntry[] = [
  {
    name: REFRESH_COOKIE,
    kind: 'cookie',
    setBy: 'Booqy (servern)',
    purpose:
      'Håller dig inloggad. Kan inte läsas av sidans skript (HttpOnly), skickas bara till inloggningstjänsten på den här adressen och byts ut vid varje förnyelse.',
    lifetime: '30 dagar, raderas när du loggar ut',
    category: 'nödvändig',
  },
  {
    name: `${LOCATION_KEY_PREFIX}{restaurang}`,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Vilken av restaurangens platser du senast valde.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: LOGOUT_PENDING_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose:
      'Finns bara om en utloggning inte nådde servern (t.ex. utan nät), så att du loggas ut på riktigt nästa gång appen öppnas. Innehåller ingen inloggning.',
    lifetime: 'Tills utloggningen gått igenom',
    category: 'nödvändig',
  },
  {
    name: `${GUIDE_KEY_PREFIX}{användar-id}`,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Att du har gått igenom introduktionsguiden, så att den inte visas igen.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: MOTION_SEEN_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Att animationerna (siffror som räknas upp, rutor som fylls) redan spelats den här inloggningen, så att de bara spelas en gång. Inga personuppgifter.',
    lifetime: 'Tills du loggar ut',
    category: 'nödvändig',
  },
  {
    name: THEME_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Ditt val av ljust eller mörkt läge (Inställningar, Den här enheten, Utseende och ljud). Samma nyckel på booqy.se och i Booqy Console. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: GLASS_BACKDROP_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Vilken bakgrund du valt bakom glaset på den här enheten: en färg eller "egen bild" (Inställningar, Den här enheten, Utseende och ljud). Själva bilden sparas på servern under ditt konto och tas bort när du tar bort den eller ditt konto. Utan val är skrivbordsappen genomskinlig och webbläsaren har Booqys bakgrund.',
    lifetime: 'Tills du byter tillbaka eller rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: APP_HINT_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Att tipset om skrivbordsappen är stängt i den här webbläsaren, så att det inte visas igen. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: SOUND_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Ditt val av klickljud på eller av (Inställningar, Den här enheten, Utseende och ljud). Sparas bara när du trycker på den. Samma nyckel på booqy.se och i Booqy Console. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: SOUND_VOLUME_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Hur högt klickljudet är, 0-100 (Inställningar, Den här enheten, Utseende och ljud). Sparas bara när du ändrar den. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: ORDER_SOUND_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Om den här enheten spelar larmljudet när en ny beställning eller cateringförfrågan kommer in (Inställningar, Den här enheten, Utseende och ljud). Sparas bara när du ändrar det. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: ORDER_ALERT_KEY,
    kind: 'sessionStorage',
    setBy: 'Booqy (rutan Ny beställning)',
    purpose: 'Vilka beställningar den här fliken redan har larmat om och vilka som står i rutan, så att en omladdning inte larmar om dem igen. Bara beställningarnas id, inga namn eller belopp.',
    lifetime: 'Tills fliken stängs, används högst 10 minuter efter en omladdning',
    category: 'nödvändig',
  },
  {
    name: CATERING_ALERT_KEY,
    kind: 'sessionStorage',
    setBy: 'Booqy (rutan Ny cateringförfrågan)',
    purpose: 'Vilka cateringförfrågningar den här fliken redan har larmat om och vilka som står i rutan, så att en omladdning inte larmar om dem igen. Bara förfrågningarnas id, inga namn eller belopp.',
    lifetime: 'Tills fliken stängs, används högst 10 minuter efter en omladdning',
    category: 'nödvändig',
  },
  {
    name: `${CATERING_PINGED_KEY_PREFIX}{plats}`,
    kind: 'localStorage',
    setBy: 'Booqy (rutan Ny cateringförfrågan)',
    purpose: 'Vilka cateringförfrågningar en flik redan har larmat om, så att inte flera öppna flikar larmar om samma förfrågan. Bara förfrågningarnas id och tid, inga namn eller belopp.',
    lifetime: 'Poster äldre än 10 minuter rensas när nästa förfrågan kommer',
    category: 'nödvändig',
  },
  {
    name: NAV_CLOSED_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Vilka grupper i sidomenyn (Under passet, Restaurangen) du har fällt ihop. Sparas bara när du fäller ihop eller öppnar en grupp. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: SAMPLE_DATA_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Att du valt att se Översikten med exempeldata i stället för restaurangens riktiga siffror. Inga personuppgifter.',
    lifetime: 'Tills du stänger av det eller rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: `${STATISTIK_OPEN_KEY_PREFIX}{användar-id}`,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Vilka avsnitt under Fördjupning på Statistik du har fällt ut, så att sidan ser likadan ut nästa gång. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: `${CALL_TEXT_VIEW_KEY_PREFIX}{användar-id}`,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Om samtalsutskrifter under Telefon visas i original, på svenska eller på engelska. Sparas bara när du väljer. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: `${TABLE_ORDER_DRAFT_KEY_PREFIX}{plats}`,
    kind: 'localStorage',
    setBy: 'Booqy (Beställningar, Ny bordsbeställning)',
    purpose: 'Rätter du har tryckt in men inte skickat än, bordet och gästens namn om du skrev ett, så att du kan fortsätta där du var. Och om bordsväljaren visar Karta eller Lista. Inga betalningsuppgifter.',
    lifetime: 'Tills beställningen skickas, högst 12 timmar',
    category: 'nödvändig',
  },
  {
    name: `${EVENT_SCAN_KEY_PREFIX}{tillfälle}`,
    kind: 'IndexedDB',
    setBy: 'Booqy (Evenemang, insläpp)',
    purpose: 'Sparar gästlistan och insläpp som gjorts utan nät vid dörren, tills de har skickats till servern.',
    lifetime: 'Tills insläppen är synkade, senast dagen efter evenemanget',
    category: 'nödvändig',
  },
  {
    name: UPDATED_FLAG_KEY,
    kind: 'sessionStorage',
    setBy: 'Booqy',
    purpose: 'Sätts en kort stund när du laddar om för en ny version, så att den nya sidan kan visa "Uppdaterad" en gång. Tas bort direkt efter. Inga personuppgifter.',
    lifetime: 'Tills sidan laddats om',
    category: 'nödvändig',
  },
]
