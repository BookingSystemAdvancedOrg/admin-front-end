/**
 * Allmänna villkor för restauranger: Booqys villkor för restaurangen som kund
 * (pris, betalning i förskott, kort eller faktura, sen betalning, uppsägning).
 * Ägaren godkänner dem bredvid personuppgiftsbiträdesavtalet.
 * UTKAST: inte juridiskt granskat. Höj versionen tillsammans med
 * CURRENT_VERSION i application/shared/terms.py, och håll avsnittet
 * "För restauranger" på booqy.se/villkor i takt.
 */

export const TERMS_VERSION = '2026-11-v1'

export const TERMS_TITLE = 'Allmänna villkor för restauranger'

export const TERMS_INTRO =
  'Villkoren gäller mellan IT Hjälparna Nordic AB, som levererar Booqy ("Booqy"), och restaurangen som använder tjänsten ("Restaurangen"). De gäller tillsammans med personuppgiftsbiträdesavtalet och det pris och den plan som Booqy har kommit överens om med Restaurangen.'

export interface TermsSection {
  title: string
  paragraphs: string[]
}

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: '1. Pris',
    paragraphs: [
      'Restaurangen betalar en fast månadsavgift enligt sin plan eller det pris som Booqy och Restaurangen har kommit överens om. Priserna anges exklusive moms; moms tillkommer med 25 procent. SMS ingår i månadsavgiften.',
      'En ändrad plan eller ett ändrat pris gäller från nästa kalendermånad. En gratisperiod har inget pris; Booqy meddelar Restaurangen senast 14 dagar innan den slutar vilken plan och vilket pris som gäller därefter.',
    ],
  },
  {
    title: '2. Fakturering i förskott',
    paragraphs: [
      'Månadsavgiften faktureras i förskott den 1:a varje kalendermånad. Den första fakturan skickas den dag avtalet börjar och avser resten av den månaden, räknat per dag. Detsamma gäller den första betalda dagen efter en gratisperiod.',
      'Restaurangen lägger till ett betalkort i Booqy Admin (Inställningar, Abonnemang). Avgiften dras då automatiskt från kortet. Lyckas inte dragningen försöker betaltjänsten Stripe igen under de följande dagarna.',
      'Så länge inget kort finns skickas fakturan med e-post med 10 dagars betalningstid. Har Booqy och Restaurangen kommit överens om betalning mot faktura gäller 30 dagars betalningstid.',
    ],
  },
  {
    title: '3. Sen betalning',
    paragraphs: [
      'Betalas en faktura inte i tid skickar Booqy påminnelser 3, 7 och 14 dagar efter förfallodagen och en sista påminnelse efter 30 dagar.',
      'Vid den första påminnelsen tar Booqy ut en påminnelseavgift på 60 kronor.',
      'Är fakturan fortfarande obetald 7 dagar efter förfallodagen tar Booqy ut förseningsersättning med 450 kronor enligt 4 a § lagen (1981:739) om ersättning för inkassokostnader m.m. Påminnelseavgiften räknas av från förseningsersättningen, så att de tillsammans aldrig överstiger 450 kronor per faktura.',
      'Dröjsmålsränta tas ut enligt 6 § räntelagen (1975:635), det vill säga Riksbankens referensränta plus åtta procentenheter per år, från förfallodagen till betalningsdagen.',
      'Avgifter och ränta är inte momspliktiga och faktureras på en separat faktura. Obetalda fakturor kan lämnas till inkasso.',
    ],
  },
  {
    title: '4. Avtalstid och uppsägning',
    paragraphs: [
      'Under en provperiod kan Restaurangen säga upp avtalet till slutet av innevarande kalendermånad. Provperioden övergår till ett abonnemang efter sex månader.',
      'Ett abonnemang har tre månaders uppsägningstid räknat från slutet av den kalendermånad då uppsägningen görs.',
      'Avgift som redan är betald i förskott återbetalas inte vid uppsägning.',
    ],
  },
  {
    title: '5. Övrigt',
    paragraphs: [
      'Restaurangens betalkort och betalningar hanteras av Stripe på Booqys konto. Restaurangens eget Stripe-konto för gästernas betalningar belastas aldrig av Booqys avgifter.',
      'Booqy får ändra villkoren med minst 30 dagars varsel. Restaurangen godkänner en ny version i Booqy Admin.',
      'Svensk lag gäller för villkoren.',
    ],
  },
]
