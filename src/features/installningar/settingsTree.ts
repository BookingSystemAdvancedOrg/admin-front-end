import type { IconName } from '../../shared/Icon'
import { slotVisible } from '../../shared/slots'
import type { Tenant } from '../../shared/tenant'
import { isDesktopShell } from '../../shared/desktopDownloads'

/**
 * Inställningarna som ett fält med träd (ägarens bild): fältet är
 * startsidan, träden är de stora områdena, grenarna är delarna (en vy i
 * taget, med egen länk #gren) och bladen är de enskilda inställningarna.
 * Äpplena (det viktigaste, som status) räknas ut i InstallningarPage.
 *
 * Grenarnas id är de gamla flikarnas, så alla länkar (#profil,
 * #betalningar ...) fungerar som förut. scripts/help-corpus.mjs läser
 * BRANCH_LABEL, BRANCH_HINT och TREES härifrån: håll varje träd på en rad.
 */
export type BranchId =
  | 'profil'
  | 'dagar'
  | 'bord'
  | 'google'
  | 'notiser'
  | 'avbokning'
  | 'integritet'
  | 'bestallning'
  | 'skrivare'
  | 'abonnemang'
  | 'betalningar'
  | 'bokforing'
  | 'statistik'
  | 'behorighet'
  | 'utseende'
  | 'skrivbordsappen'

export type TreeId = 'restaurangen' | 'gaster' | 'bestallningar' | 'ekonomi' | 'personalen' | 'enheten'

export const BRANCH_LABEL: Record<BranchId, string> = {
  profil: 'Profil och kontakt',
  dagar: 'Öppettider och avvikande dagar',
  bord: 'Bokning',
  google: 'Google-profil',
  notiser: 'Notiser',
  avbokning: 'Avbokning och kortgaranti',
  integritet: 'Integritet',
  bestallning: 'Beställning online',
  skrivare: 'Skrivare och stationer',
  abonnemang: 'Abonnemang',
  betalningar: 'Betalningar',
  bokforing: 'Bokföring',
  statistik: 'Statistik',
  behorighet: 'Behörigheter',
  utseende: 'Utseende och ljud',
  skrivbordsappen: 'Appen',
}

/** En rad om vad varje gren ställer in. Syns inte; hjälpassistenten läser den (scripts/help-corpus.mjs). */
export const BRANCH_HINT: Record<BranchId, string> = {
  profil: 'Namn, adress, telefon, e-post och väntetid för sena gäster',
  dagar: 'Öppettider per veckodag, helgdagar, stängt eller andra tider en viss dag',
  bord: 'Bokningstid, hur många gäster varje bord tar online och kön',
  google: 'Koppla restaurangens Google-profil och svara på omdömen',
  notiser: 'Sms och mejl till gästerna, och mejl till er',
  avbokning: 'Kortgaranti och avgift om gästen inte kommer',
  integritet: 'Integritetspolicyn och gästernas uppgifter',
  bestallning: 'Beställning online med avhämtning, tillagningstid och sista beställning',
  skrivare: 'Skrivaren i köket som skriver ut beställningarna och stationerna',
  abonnemang: 'Er plan hos Booqy, betalkortet och fakturorna',
  betalningar: 'Koppla Stripe så att gästerna kan betala online',
  bokforing: 'Exportera försäljningen till bokföringsprogrammet',
  statistik: 'När lunchen slutar och middagen börjar i statistiken',
  behorighet: 'Vilka sidor personalen får öppna, för alla eller en person i taget',
  utseende: 'Ljust eller mörkt läge och klickljud, bara på den här skärmen',
  skrivbordsappen: 'Booqy som app på datorn eller telefonen',
}

export interface Tree {
  id: TreeId
  label: string
  icon: IconName
  branches: BranchId[]
}

export const TREES: Tree[] = [
  { id: 'restaurangen', label: 'Restaurangen', icon: 'home', branches: ['profil', 'dagar', 'bord', 'google'] },
  { id: 'gaster', label: 'Gäster', icon: 'users', branches: ['notiser', 'avbokning', 'integritet'] },
  { id: 'bestallningar', label: 'Beställning', icon: 'bag', branches: ['bestallning', 'skrivare'] },
  { id: 'ekonomi', label: 'Ekonomi', icon: 'chart', branches: ['abonnemang', 'betalningar', 'bokforing', 'statistik'] },
  { id: 'personalen', label: 'Personal', icon: 'staff', branches: ['behorighet'] },
  { id: 'enheten', label: 'Den här enheten', icon: 'mobile', branches: ['utseende', 'skrivbordsappen'] },
]

export const BRANCHES = TREES.flatMap((t) => t.branches)

export function isBranch(id: string): id is BranchId {
  return id in BRANCH_LABEL
}

export function isTree(id: string): id is TreeId {
  return TREES.some((t) => t.id === id)
}

export function treeOf(branch: BranchId): Tree {
  return TREES.find((t) => t.branches.includes(branch)) as Tree
}

/** Grenar som bara ägaren ser (personalen ser de andra, utan att kunna ändra). */
const OWNER_ONLY: BranchId[] = ['abonnemang', 'bokforing', 'statistik', 'behorighet', 'integritet']

/** Syns grenen för den inloggade (roll, plan, skrivbordsappen)? */
export function branchVisible(branch: BranchId, tenant: Tenant | null | undefined): boolean {
  if (OWNER_ONLY.includes(branch)) return tenant?.role === 'owner_user'
  if (branch === 'bestallning' || branch === 'skrivare') return Boolean(tenant?.entitlements.features.ordering)
  if (branch === 'google') return slotVisible(tenant, 'installningar.verksamhet.google')
  if (branch === 'skrivbordsappen') return !isDesktopShell()
  return true
}

/**
 * Bladen som sökfältet hittar: namnet som syns, grenen det ligger i och
 * eventuellt andra ord man kan söka på. `find` är texten i kortet som lyses
 * upp när den skiljer sig från namnet (flera skiljs med |).
 */
export interface Leaf {
  label: string
  branch: BranchId
  find?: string
  keywords?: string
}

export const LEAVES: Leaf[] = [
  { label: 'Namn', branch: 'profil', find: 'Namn', keywords: 'restaurangens namn' },
  { label: 'Telefon', branch: 'profil', keywords: 'telefonnummer kontakt' },
  { label: 'Adress', branch: 'profil', keywords: 'gatuadress' },
  { label: 'E-post', branch: 'profil', keywords: 'mejl kontakt' },
  { label: 'Väntetid för sena gäster', branch: 'profil', keywords: 'sen grace' },
  { label: 'Öppettider', branch: 'dagar', keywords: 'öppet stänger veckodagar' },
  { label: 'Avvikande öppettider', branch: 'dagar', keywords: 'helgdag stängt jul midsommar' },
  { label: 'Bokningstid', branch: 'bord', keywords: 'sittning längd' },
  { label: 'Sista sittning', branch: 'bord', find: 'Sista sittning' },
  { label: 'Bord vid onlinebokning', branch: 'bord', keywords: 'bordsregler sällskap kombinationer' },
  { label: 'Kö', branch: 'bord', find: 'Kö', keywords: 'väntelista hålltid' },
  { label: 'Google-profil', branch: 'google', keywords: 'omdömen recensioner' },
  { label: 'SMS till gästen', branch: 'notiser', keywords: 'sms' },
  { label: 'Avsändarnamn i SMS', branch: 'notiser' },
  { label: 'Påminnelse före besöket', branch: 'notiser', keywords: 'påminnelse' },
  { label: 'E-post till restaurangen', branch: 'notiser', keywords: 'mejl bokning' },
  { label: 'Kortgaranti', branch: 'avbokning', keywords: 'kort garanti' },
  { label: 'No-show-avgift', branch: 'avbokning', find: 'No-show', keywords: 'utebliven' },
  { label: 'Avgift vid sen avbokning', branch: 'avbokning', find: 'Avgift sen avbokning', keywords: 'avboka' },
  { label: 'Integritetspolicy för gäster', branch: 'integritet', keywords: 'gdpr' },
  { label: 'Gästens uppgifter och samtycken', branch: 'integritet', keywords: 'radera exportera gdpr samtycke' },
  { label: 'Ta emot beställningar', branch: 'bestallning', keywords: 'beställa online' },
  { label: 'Avhämtning', branch: 'bestallning', find: 'Ta emot beställningar', keywords: 'takeaway hämta' },
  { label: 'Bongskrivare', branch: 'skrivare', keywords: 'skrivare kök bong' },
  { label: 'Bongar och stationer', branch: 'skrivare', keywords: 'station bar kök allergi' },
  { label: 'Abonnemang', branch: 'abonnemang', find: 'Abonnemang', keywords: 'plan pris' },
  { label: 'Betalkort', branch: 'abonnemang', find: 'Betalning', keywords: 'kort byt kort faktura' },
  { label: 'Stripe', branch: 'betalningar', find: 'Betalningar', keywords: 'kortbetalning utbetalning' },
  { label: 'Exportera till bokföringen', branch: 'bokforing', keywords: 'sie csv fortnox visma' },
  { label: 'Konton', branch: 'bokforing', keywords: 'kontoplan verifikation räkenskapsår' },
  { label: 'Lunchen slutar', branch: 'statistik', keywords: 'lunch middag' },
  { label: 'Personalens behörighet', branch: 'behorighet', keywords: 'personal sidor åtkomst' },
  { label: 'Ljust eller mörkt', branch: 'utseende', keywords: 'tema mörkt läge' },
  { label: 'Bakgrund', branch: 'utseende', keywords: 'bild färg' },
  { label: 'Klickljud', branch: 'utseende', keywords: 'ljud' },
  { label: 'Volym', branch: 'utseende', keywords: 'ljud' },
  { label: 'Appen', branch: 'skrivbordsappen', find: 'Skrivbordsappen|Appen på telefonen', keywords: 'ladda ner installera skrivbordsappen telefon' },
]

/** Små bokstäver utan accenter, för sökningen. */
export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

/** Blad som matchar sökningen (namn, grenens och trädets namn, sökord). */
export function searchLeaves(query: string, visible: (b: BranchId) => boolean): Leaf[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return LEAVES.filter((leaf) => {
    if (!visible(leaf.branch)) return false
    const hay = fold(`${leaf.label} ${BRANCH_LABEL[leaf.branch]} ${treeOf(leaf.branch).label} ${leaf.keywords ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
    .sort((a, b) => Number(!fold(a.label).startsWith(words[0])) - Number(!fold(b.label).startsWith(words[0])))
    .slice(0, 8)
}
