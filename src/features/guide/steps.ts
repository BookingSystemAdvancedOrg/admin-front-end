/**
 * Introduktionsguidens steg, i den ordning de visas. `target` är värdet på
 * ett `data-tour`-attribut i gränssnittet; steg vars mål inte finns på
 * skärmen (t.ex. Beställningar när planen saknar det, eller platsväljaren
 * när restaurangen bara har en plats) hoppas över automatiskt.
 * Steg utan `target` visas mitt på skärmen.
 */
export interface GuideStep {
  id: string
  target?: string
  title: string
  text: string
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Välkommen till Booqy Admin',
    text:
      'Här sköter du restaurangens bokningar, beställningar, meny och catering. ' +
      'Guiden visar var allt finns - det tar ungefär en minut.',
  },
  {
    id: 'location',
    target: 'location-picker',
    title: 'Plats',
    text: 'Har ni flera restauranger väljer du här vilken du arbetar med. Allt du ser gäller den valda platsen.',
  },
  {
    id: 'oversikt',
    target: 'nav-oversikt',
    title: 'Översikt',
    text: 'Dagens läge på ett ställe: bokningar, beställningar och det som väntar på dig.',
  },
  {
    id: 'bokningar',
    target: 'nav-bokningar',
    title: 'Bokningar',
    text:
      'Se dagens bord, lägg in bokningar som kommer via telefon och markera gäster som anlända. ' +
      'Tryck på en bokning för att ändra eller avboka den.',
  },
  {
    id: 'bestallningar',
    target: 'nav-bestallningar',
    title: 'Beställningar',
    text:
      'Köket ser nya matbeställningar här. Tryck "Påbörja" när ni börjar laga - då får gästen ett sms - ' +
      'och "Klar" när maten kan hämtas.',
  },
  {
    id: 'meny',
    target: 'nav-meny',
    title: 'Meny',
    text: 'Lägg till rätter, priser och bilder. Med reglaget döljer du en rätt tillfälligt, t.ex. när den är slut.',
  },
  {
    id: 'catering',
    target: 'nav-catering',
    title: 'Catering',
    text:
      'Förfrågningar från gäster som vill beställa catering. Du skickar en offert och gästen godkänner med BankID. ' +
      'Priser och rabatter ställer du in under "Inställningar och rabatter".',
  },
  {
    id: 'layout',
    target: 'nav-layout',
    title: 'Layout',
    text: 'Rita matsalen med väggar och bord. Gästerna väljer bord på den här planritningen när de bokar online.',
  },
  {
    id: 'installningar',
    target: 'nav-installningar',
    title: 'Inställningar',
    text: 'Öppettider, personal, betalningar, notiser och regler för bokning. Varje del har en egen flik.',
  },
  {
    id: 'hjalp',
    target: 'nav-hjalp',
    title: 'Hjälp',
    text: 'Här hittar du guiden igen och en kort förklaring av varje del. Lycka till!',
  },
]
