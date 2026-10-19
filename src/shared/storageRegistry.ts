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
]
