/**
 * Introduktionsguidens steg, i den ordning de visas.
 *
 * - `route`: sidan (och ev. #flik) guiden går till innan bubblan visas.
 * - `target`: värdet på ett `data-tour`-attribut på den sidan. Finns målet
 *   inte (t.ex. en tom meny) hoppar guiden vidare till nästa steg.
 *   Steg utan `target` visas mitt på skärmen.
 * - `ownerOnly`: bara restaurangens ägare (personal kan inte ändra det).
 * - `feature`: bara när restaurangens plan har funktionen.
 */
export interface GuideStep {
  id: string
  route?: string
  target?: string
  title: string
  text: string
  ownerOnly?: boolean
  feature?: 'ordering' | 'catering' | 'marketing'
  /** Bara när restaurangen har flera platser (platsväljaren). */
  multiLocation?: boolean
  /** Rubrik i Hjälp-sidans lista (bara på stegen som beskriver en hel del). */
  section?: string
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    route: '/',
    title: 'Välkommen till Booqy Admin',
    text:
      'Här sköter du restaurangens bokningar, beställningar, meny och catering. ' +
      'Guiden visar steg för steg hur allt fungerar - det tar ett par minuter.',
  },
  {
    id: 'location',
    target: 'location-picker',
    multiLocation: true,
    title: 'Plats',
    text: 'Har ni flera restauranger väljer du här vilken du arbetar med. Allt du ser gäller den valda platsen.',
  },

  // --- Översikt ------------------------------------------------------------
  {
    id: 'oversikt',
    route: '/',
    target: 'nav-oversikt',
    section: 'Översikt',
    title: 'Översikt',
    text: 'Dagens läge på ett ställe: öppettider, bokningar, beställningar och det som väntar på dig.',
  },
  {
    id: 'kom-igang',
    route: '/',
    target: 'getting-started',
    ownerOnly: true,
    title: 'Kom igång',
    text:
      'Längst ner på Översikt: din checklista för att bli redo - öppettider, meny, planritning, betalningar och personal. ' +
      'Tryck på ett steg för att gå dit. Listan försvinner när allt är klart.',
  },

  // --- Inställningar (viktigast för ägaren) ---------------------------------
  {
    id: 'installningar',
    route: '/installningar#profil',
    target: 'nav-installningar',
    section: 'Inställningar',
    title: 'Inställningar',
    text:
      'Det viktigaste att gå igenom först. Inställningarna är uppdelade i flikar - vi tar dem en i taget.',
  },
  {
    id: 'set-profil',
    route: '/installningar#profil',
    target: 'settings-tab-profil',
    ownerOnly: true,
    title: 'Restaurang',
    text:
      'Namn, adress, telefon, e-post och öppettider. Gästerna ser detta på er webbplats och kan bara boka när ni har öppet.',
  },
  {
    id: 'set-save',
    route: '/installningar#profil',
    target: 'settings-save',
    ownerOnly: true,
    title: 'Spara',
    text: 'Ändringar under Restaurang sparas med den här knappen. De andra flikarna har var sin Spara-knapp.',
  },
  {
    id: 'set-personal',
    route: '/installningar#personal',
    target: 'settings-tab-personal',
    ownerOnly: true,
    title: 'Personal',
    text:
      'Bjud in medarbetare med "+ Bjud in personal". De får ett mejl, loggar in och ser bokningar, beställningar och menyn för sin plats.',
  },
  {
    id: 'set-betalningar',
    route: '/installningar#betalningar',
    target: 'settings-tab-betalningar',
    ownerOnly: true,
    title: 'Betalningar',
    text:
      'Koppla restaurangens konto hos Stripe för att ta betalt online - för beställningar, catering och kortgaranti. Pengarna går direkt till er.',
  },
  {
    id: 'set-notiser',
    route: '/installningar#notiser',
    target: 'settings-tab-notiser',
    ownerOnly: true,
    title: 'Notiser',
    text: 'Välj om gästerna får sms, när påminnelsen skickas och om ni vill få mejl vid nya bokningar.',
  },
  {
    id: 'set-avbokning',
    route: '/installningar#avbokning',
    target: 'settings-tab-avbokning',
    ownerOnly: true,
    title: 'Avbokning',
    text:
      'Kortgaranti för större sällskap: gästen lägger in sitt kort när hen bokar, och ni kan ta en avgift om ingen kommer.',
  },
  {
    id: 'set-bestallning',
    route: '/installningar#bestallning',
    target: 'settings-tab-bestallning',
    ownerOnly: true,
    feature: 'ordering',
    title: 'Beställning',
    text: 'Slå på avhämtning och beställning vid bordet, och skapa QR-koder att ställa på borden.',
  },
  {
    id: 'set-dagar',
    route: '/installningar#dagar',
    target: 'settings-tab-dagar',
    ownerOnly: true,
    title: 'Avvikande dagar',
    text: 'Helgdagar, stängt för privat fest eller andra tider - lägg in dem här så stämmer bokningen.',
  },
  {
    id: 'set-bord',
    route: '/installningar#bord',
    target: 'settings-tab-bord',
    ownerOnly: true,
    title: 'Bord',
    text:
      'Hur många gäster varje bord passar online, och vilka bord som kan ställas ihop för större sällskap.',
  },

  // --- Meny ------------------------------------------------------------------
  {
    id: 'meny',
    route: '/meny',
    target: 'nav-meny',
    section: 'Meny',
    title: 'Meny',
    text: 'Här finns alla rätter som visas på er webbplats och som gästerna kan beställa.',
  },
  {
    id: 'menu-add',
    route: '/meny',
    target: 'menu-add',
    title: 'Lägg till en rätt',
    text: 'Fyll i namn, beskrivning, pris och kategori - och lägg gärna till en bild. Rätten syns direkt på webbplatsen.',
  },
  {
    id: 'menu-toggle',
    route: '/meny',
    target: 'menu-row-toggle',
    title: 'Dölj en rätt tillfälligt',
    text: 'Slut för dagen? Slå av reglaget så döljs rätten för gästerna. Slå på det igen när den finns.',
  },
  {
    id: 'menu-edit',
    route: '/meny',
    target: 'menu-row-actions',
    title: 'Ändra eller ta bort',
    text: '"Redigera" ändrar pris, text eller bild. "Radera" tar bort rätten helt.',
  },

  // --- Bokningar -------------------------------------------------------------
  {
    id: 'bokningar',
    route: '/bokningar',
    target: 'nav-bokningar',
    section: 'Bokningar',
    title: 'Bokningar',
    text: 'Alla bordsbokningar - både de gästerna gör online och de ni lägger in själva.',
  },
  {
    id: 'booking-day',
    route: '/bokningar',
    target: 'booking-day',
    title: 'Välj dag',
    text: 'Bläddra mellan dagar med pilarna eller välj ett datum.',
  },
  {
    id: 'booking-list',
    route: '/bokningar',
    target: 'booking-list',
    title: 'Hantera en bokning',
    text:
      'Tryck på en bokning för att markera gästen som anländ, ändra tid eller bord, markera utebliven eller avboka. Gästen får besked automatiskt.',
  },
  {
    id: 'booking-new',
    route: '/bokningar',
    target: 'booking-new',
    title: 'Ny bokning',
    text: 'Ringer en gäst eller kommer in direkt? Lägg in bokningen här så blir bordet upptaget online också.',
  },

  // --- Beställningar ---------------------------------------------------------
  {
    id: 'bestallningar',
    route: '/bestallningar',
    target: 'nav-bestallningar',
    feature: 'ordering',
    section: 'Beställningar',
    title: 'Beställningar',
    text: 'Matbeställningar från gästerna, betalda i förväg.',
  },
  {
    id: 'orders-board',
    route: '/bestallningar',
    target: 'orders-board',
    feature: 'ordering',
    title: 'Från ny till klar',
    text:
      'Nya → Tillagas → Klara. Tryck "Påbörja" när köket börjar laga (gästen får ett sms) och "Klar" när maten kan hämtas eller serveras.',
  },
  {
    id: 'orders-pause',
    route: '/bestallningar',
    target: 'orders-pause',
    feature: 'ordering',
    title: 'Pausa vid rusning',
    text: 'Hinner köket inte med? Pausa nya beställningar en stund - de som redan kommit in påverkas inte.',
  },

  // --- Catering --------------------------------------------------------------
  {
    id: 'catering',
    route: '/catering',
    target: 'nav-catering',
    feature: 'catering',
    section: 'Catering',
    title: 'Catering',
    text: 'Förfrågningar från gäster som vill beställa catering via er webbplats.',
  },
  {
    id: 'catering-list',
    route: '/catering',
    target: 'catering-list',
    feature: 'catering',
    title: 'Svara med en offert',
    text:
      'Öppna en förfrågan, justera rätter och pris och skicka offerten. Gästen godkänner med BankID och betalar - eller får faktura om det är ett företag.',
  },
  {
    id: 'catering-settings',
    route: '/catering',
    target: 'catering-settings',
    feature: 'catering',
    ownerOnly: true,
    title: 'Catering på webbplatsen',
    text: 'Här slår du på catering för gästerna och ställer in minsta antal portioner, leveranspriser och rabatter.',
  },

  // --- Layout ----------------------------------------------------------------
  {
    id: 'layout',
    route: '/layout',
    target: 'nav-layout',
    section: 'Layout',
    title: 'Layout',
    text: 'Rita matsalen. Gästerna väljer bord på den här planritningen när de bokar online.',
  },
  {
    id: 'layout-tools',
    route: '/layout',
    target: 'layout-tools',
    title: 'Rita',
    text: 'Välj ett verktyg: rita mark (väggar kommer automatiskt), lägg till fönster, entré och bord. Dra för att flytta.',
  },
  {
    id: 'layout-publish',
    route: '/layout',
    target: 'layout-publish',
    title: 'Publicera',
    text: 'Ändringar sparas som utkast. När du publicerar ser gästerna den nya planritningen.',
  },

  // --- Marknadsföring --------------------------------------------------------
  {
    id: 'marknadsforing',
    route: '/marknadsforing',
    target: 'nav-marknadsforing',
    feature: 'marketing',
    ownerOnly: true,
    section: 'Marknadsföring',
    title: 'Marknadsföring',
    text:
      'Se varifrån besökarna på er webbplats kommer och vad det ger i bokningar, utan cookies. Skicka nyhetsbrev och erbjudanden till gäster som själva bett om det.',
  },

  // --- Hjälp -----------------------------------------------------------------
  {
    id: 'hjalp',
    target: 'nav-hjalp',
    title: 'Hjälp',
    text: 'Här hittar du guiden igen och en kort förklaring av varje del. Lycka till!',
  },
]

export interface GuideContext {
  isOwner: boolean
  features: Record<string, boolean>
  /** Antal platser restaurangen har. */
  locations?: number
}

/** Stegen för just den här användaren (roll och restaurangens plan). */
export function stepsFor(ctx: GuideContext): GuideStep[] {
  return GUIDE_STEPS.filter(
    (s) =>
      (!s.ownerOnly || ctx.isOwner) &&
      (!s.feature || Boolean(ctx.features[s.feature])) &&
      (!s.multiLocation || (ctx.locations ?? 1) > 1),
  )
}
