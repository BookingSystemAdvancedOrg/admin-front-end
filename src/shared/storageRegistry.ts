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

export type StorageKind = 'cookie' | 'localStorage' | 'sessionStorage'
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
export const SOUND_KEY = 'booqy-sound'
export const SOUND_VOLUME_KEY = 'booqy-sound-volume'
export const SAMPLE_DATA_KEY = 'booqy-sample-data'
export const CARD_READER_KEY_PREFIX = 'booqy-card-reader:'

export const STORAGE_REGISTRY: readonly StorageEntry[] = [
  {
    name: REFRESH_COOKIE,
    kind: 'cookie',
    setBy: 'Booqy (servern)',
    purpose:
      'Håller dig inloggad. Kan inte läsas av sidans skript (HttpOnly), skickas bara till inloggningstjänsten på den här adressen och byts ut vid varje förnyelse.',
    lifetime: '12 timmar, raderas när du loggar ut',
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
    purpose: 'Ditt val av ljust eller mörkt läge (Inställningar, Utseende och ljud). Samma nyckel på booqy.se och i Booqy Console. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: SOUND_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Ditt val av klickljud på eller av (Inställningar, Utseende och ljud). Sparas bara när du trycker på den. Samma nyckel på booqy.se och i Booqy Console. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
  {
    name: SOUND_VOLUME_KEY,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Hur högt klickljudet är, 0-100 (Inställningar, Utseende och ljud). Sparas bara när du ändrar den. Inga personuppgifter.',
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
    name: `${CARD_READER_KEY_PREFIX}{plats}`,
    kind: 'localStorage',
    setBy: 'Booqy',
    purpose: 'Vilken kortläsare du senast valde under Ta betalt på den här enheten, så att den är förvald nästa gång. Inga personuppgifter.',
    lifetime: 'Tills du rensar webbläsaren',
    category: 'nödvändig',
  },
]
