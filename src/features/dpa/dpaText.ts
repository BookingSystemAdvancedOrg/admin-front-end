/**
 * Personuppgiftsbiträdesavtalet som ägaren godkänner i admin.
 * UTKAST: texten är inte juridiskt granskad (application/docs/dpa-draft.md).
 * Ändra texten här och i docs/dpa-draft.md tillsammans och höj versionen,
 * som måste vara samma som CURRENT_VERSION i application/shared/dpa.py.
 */

export const DPA_VERSION = "2026-10-v1"

export const DPA_TITLE = "Personuppgiftsbiträdesavtal"

export const DPA_INTRO =
  "Det här avtalet gäller mellan restaurangen som använder Booqy (den personuppgiftsansvarige, \"Restaurangen\") och IT Hjälparna Nordic AB, som levererar Booqy (personuppgiftsbiträdet, \"Biträdet\"). Det är en del av avtalet om Booqy och gäller så länge Biträdet behandlar personuppgifter för Restaurangens räkning."

export interface DpaSection {
  title: string
  paragraphs: string[]
  /** Bilagor visas som punktlistor. */
  list?: boolean
}

export const DPA_SECTIONS: DpaSection[] = [
  {
    title: "1. Bakgrund och roller",
    paragraphs: [
      "Restaurangen är personuppgiftsansvarig för de uppgifter om gäster som behandlas i Booqy: bokningar, beställningar, cateringförfrågningar och marknadsföring.",
      "Biträdet behandlar dessa uppgifter bara för Restaurangens räkning och enligt det här avtalet. För uppgifter om restaurangens användarkonton i Booqy Admin (personalens namn, e-post, roll och inloggning) är Biträdet själv personuppgiftsansvarig.",
      "Begrepp i avtalet har samma betydelse som i dataskyddsförordningen (EU) 2016/679 (\"GDPR\").",
    ],
  },
  {
    title: "2. Behandlingen",
    paragraphs: [
      "Föremål, art, ändamål, kategorier av uppgifter och registrerade samt behandlingens varaktighet beskrivs i bilaga 1.",
      "Restaurangen ansvarar för att det finns en rättslig grund för behandlingen, för att gästerna får information enligt artikel 13 och 14 GDPR och för innehållet i de uppgifter Restaurangen själv för in i Booqy.",
    ],
  },
  {
    title: "3. Instruktioner",
    paragraphs: [
      "Biträdet behandlar personuppgifterna endast enligt Restaurangens dokumenterade instruktioner. Avtalet, Restaurangens inställningar i Booqy Admin och det Restaurangen gör i tjänsten utgör instruktionerna.",
      "Om Biträdet anser att en instruktion strider mot GDPR eller annan dataskyddslag informerar Biträdet Restaurangen utan dröjsmål.",
      "Om lag kräver att Biträdet behandlar uppgifterna på annat sätt informerar Biträdet Restaurangen innan behandlingen börjar, om lagen inte förbjuder det.",
    ],
  },
  {
    title: "4. Sekretess",
    paragraphs: [
      "Biträdet ser till att de personer som har tillgång till personuppgifterna har åtagit sig att iaktta konfidentialitet eller omfattas av lagstadgad tystnadsplikt, och att de bara får tillgång i den omfattning som behövs.",
    ],
  },
  {
    title: "5. Säkerhet",
    paragraphs: [
      "Biträdet vidtar de tekniska och organisatoriska åtgärder som krävs enligt artikel 32 GDPR. Åtgärderna beskrivs i bilaga 2 och får förbättras löpande så länge skyddsnivån inte sänks.",
    ],
  },
  {
    title: "6. Underbiträden",
    paragraphs: [
      "Restaurangen ger Biträdet ett allmänt förhandstillstånd att anlita underbiträden. De underbiträden som används när avtalet ingås finns i bilaga 3.",
      "Biträdet informerar Restaurangen minst 30 dagar innan ett underbiträde läggs till eller byts ut. Restaurangen får invända av sakliga skäl inom den tiden. Kan parterna inte enas får Restaurangen säga upp avtalet om Booqy till upphörande innan ändringen gäller.",
      "Biträdet ingår skriftliga avtal med underbiträden med samma dataskyddsskyldigheter som i det här avtalet och ansvarar mot Restaurangen för underbiträdenas fullgörande.",
    ],
  },
  {
    title: "7. Överföring till tredje land",
    paragraphs: [
      "Personuppgifterna lagras och behandlas inom EU/EES (Amazon Web Services, region Stockholm). Om ett underbiträde behandlar uppgifter utanför EU/EES sker det bara med stöd av kapitel V GDPR, till exempel EU-kommissionens beslut om adekvat skyddsnivå (EU-U.S. Data Privacy Framework) eller standardavtalsklausuler, se bilaga 3.",
    ],
  },
  {
    title: "8. Bistånd till Restaurangen",
    paragraphs: [
      "Biträdet hjälper Restaurangen, med hänsyn till behandlingens art och den information Biträdet har, att besvara begäranden från registrerade (till exempel om tillgång, rättelse, radering och dataportabilitet). Mycket av detta kan Restaurangen göra själv i Booqy Admin.",
      "Biträdet hjälper Restaurangen att fullgöra skyldigheterna i artikel 32-36 GDPR (säkerhet, personuppgiftsincidenter, konsekvensbedömningar och förhandssamråd).",
      "Om en begäran från en registrerad kommer direkt till Biträdet hänvisas den till Restaurangen utan dröjsmål.",
    ],
  },
  {
    title: "9. Personuppgiftsincidenter",
    paragraphs: [
      "Biträdet underrättar Restaurangen utan onödigt dröjsmål, och senast inom 48 timmar, efter att ha fått kännedom om en personuppgiftsincident som rör Restaurangens uppgifter.",
      "Underrättelsen innehåller så långt det är möjligt vad som har hänt, vilka kategorier och ungefär hur många registrerade och poster som berörs, de troliga konsekvenserna och vilka åtgärder som vidtagits eller föreslås. Information som inte finns direkt lämnas så snart den finns.",
    ],
  },
  {
    title: "10. Granskning",
    paragraphs: [
      "Biträdet ger Restaurangen den information som behövs för att visa att skyldigheterna i artikel 28 GDPR uppfylls.",
      "Restaurangen, eller en oberoende granskare som omfattas av tystnadsplikt, får granska Biträdets behandling efter minst 30 dagars skriftligt förvarsel, högst en gång per år om inte en incident eller en tillsynsmyndighet motiverar mer. Granskningen får inte ge tillgång till andra kunders uppgifter. Restaurangen står för sina egna kostnader.",
    ],
  },
  {
    title: "11. När avtalet upphör",
    paragraphs: [
      "När avtalet om Booqy upphör kan Restaurangen begära en export av sina uppgifter. Därefter raderar Biträdet Restaurangens personuppgifter, senast 90 dagar efter att kontot har avslutats, om inte lag kräver att uppgifterna sparas längre (till exempel underlag enligt bokföringslagen, som då bara sparas för det ändamålet).",
      "Säkerhetskopior skrivs över enligt sitt ordinarie schema och används inte för något annat än återställning.",
    ],
  },
  {
    title: "12. Ansvar",
    paragraphs: [
      "Parternas ansvar gentemot varandra följer avtalet om Booqy. Ansvaret gentemot registrerade och tillsynsmyndigheter följer artikel 82 och 83 GDPR.",
    ],
  },
  {
    title: "13. Giltighet, ändringar och tvister",
    paragraphs: [
      "Avtalet gäller från att Restaurangen godkänner det i Booqy Admin och så länge Biträdet behandlar personuppgifter för Restaurangens räkning.",
      "Biträdet kan ta fram en ny version av avtalet, till exempel när lag eller underbiträden ändras. Den nya versionen visas i Booqy Admin och gäller när Restaurangen har godkänt den. Biträdet sparar vilken version som godkänts, när och av vem.",
      "Svensk lag gäller. Tvister avgörs av allmän domstol med Stockholms tingsrätt som första instans.",
    ],
  },
  {
    title: "Bilaga 1. Behandlingens omfattning",
    list: true,
    paragraphs: [
      "Ändamål: att tillhandahålla Booqy till Restaurangen: bordsbokning, onlinebeställning med betalning, catering med offert, signering och betalning, notiser till gäster via e-post och SMS samt, om Restaurangen använder det, marknadsföring via e-post till gäster som samtyckt.",
      "Registrerade: Restaurangens gäster och kunder (privatpersoner och kontaktpersoner hos företag) samt personer som anmäler sig till Restaurangens erbjudanden.",
      "Personuppgifter: namn, e-postadress, telefonnummer, uppgifter om bokningen, beställningen eller cateringen (datum, tid, antal, rätter, leveransadress, belopp), meddelanden till restaurangen, betalningsstatus (aldrig kortnummer), vid catering namn och personnummer från BankID-signeringen samt IP-adress och webbläsare vid signering, samtycken till marknadsföring och klick i utskick.",
      "Särskilda kategorier: gäster kan själva skriva in uppgifter om hälsa, till exempel allergier, i ett meddelande. Sådana uppgifter används bara för att förbereda besöket.",
      "Behandlingar: insamling, lagring, visning för Restaurangens personal, utskick av meddelanden, betalningshantering, statistik på aggregerad nivå, radering.",
      "Varaktighet: så länge avtalet om Booqy gäller och därefter enligt punkt 11. Under avtalstiden raderas uppgifter enligt de lagringstider som visas i Booqy.",
    ],
  },
  {
    title: "Bilaga 2. Säkerhetsåtgärder",
    list: true,
    paragraphs: [
      "All data lagras i Amazon Web Services region Stockholm (eu-north-1) och är krypterad i vila och under överföring (TLS).",
      "Varje restaurang är logiskt separerad: varje anrop kontrolleras mot den inloggade användarens restaurang, och personal ser bara sin egen plats.",
      "Inloggning sker med personliga konton och roller (ägare och personal). Inloggningssessionen lagras i en säker cookie som skript inte kan läsa.",
      "Minsta behörighet för systemets egna komponenter; separata AWS-konton för utveckling och produktion.",
      "Säkerhetskopiering med återställning till valfri tidpunkt för de viktigaste tabellerna.",
      "Skydd mot automatiserade bokningar (Cloudflare Turnstile) och begränsning av SMS till nordiska nummer.",
      "Notiser till restaurangens gemensamma inkorg innehåller inte gästens kontaktuppgifter eller fritext; de finns bakom inloggning.",
    ],
  },
  {
    title: "Bilaga 3. Underbiträden",
    list: true,
    paragraphs: [
      "Amazon Web Services EMEA SARL (Luxemburg): drift, lagring, e-post (Amazon SES) och SMS (Amazon SNS). Behandling i region Stockholm (eu-north-1). Bolaget ingår i en amerikansk koncern; överföring sker i så fall med stöd av EU-U.S. Data Privacy Framework och standardavtalsklausuler.",
      "Stripe Payments Europe Ltd (Irland): kortbetalningar och kortgarantier via Restaurangens eget Stripe-konto. Kortuppgifter går direkt till Stripe. Överföring till Stripe, Inc. (USA) med stöd av EU-U.S. Data Privacy Framework och standardavtalsklausuler.",
      "Cloudflare, Inc. (USA): Turnstile, skydd mot automatiserade bokningar, beställningar och cateringförfrågningar (IP-adress och tekniska uppgifter om webbläsaren). Överföring med stöd av EU-U.S. Data Privacy Framework och standardavtalsklausuler.",
      "Finansiell ID-Teknik BID AB (Sverige): BankID-signering av cateringofferter.",
    ],
  },
]
