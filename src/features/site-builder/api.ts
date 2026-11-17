import { apiFetch } from '../../shared/api'
import type { FeatureKey } from '../../shared/contracts'
import type { Tenant } from '../../shared/tenant'

/** Webbplatsbyggaren (CONTRACTS.md 6.B). Dokumentets form: application/shared/site_schema/v1.json. */

export type BlockType = 'hero' | 'text' | 'image' | 'gallery' | 'menu' | 'openingHours' | 'bookingCta' | 'orderCta' | 'cateringCta' | 'contact'

export interface Block {
  id: string
  type: BlockType
  heading?: string
  text?: string
  body?: string
  label?: string
  image?: string
  alt?: string
  caption?: string
  images?: { image: string; alt: string }[]
  cta?: { label: string; link: string }
  locationId?: string
  showMap?: boolean
}

export interface SitePage {
  id: string
  slug: string
  title: string
  seo: { title: string; description: string }
  blocks: Block[]
}

export interface SiteDoc {
  schemaVersion: 1
  theme: { primaryColor: string; accentColor: string; font: 'serif' | 'sans' }
  nav: { pageId: string }[]
  pages: SitePage[]
  footer: { text: string }
}

export interface SiteState {
  mode: 'builder' | 'custom'
  draft: { doc: SiteDoc; version: number; basedOn: number | null }
  published?: { versionNo: number; publishedAt: string }
}

export interface Version {
  versionNo: number
  source: 'builder' | 'custom'
  publishedAt: string
  publishedBy: string
  live: boolean
}

export const getSite = () => apiFetch<SiteState>('/tenant/site-builder')
export const saveDraft = (doc: SiteDoc, version: number) =>
  apiFetch<SiteState['draft']>('/tenant/site-builder/draft', { method: 'PUT', body: JSON.stringify({ doc, version }) })
export const createPreviewLink = () =>
  apiFetch<{ url: string; expiresAt: string }>('/tenant/site-builder/preview-links', { method: 'POST', body: '{}' })
export const publish = (publishId: string, draftVersion: number) =>
  apiFetch<{ publishId: string; status: string }>('/tenant/site-builder/publish', {
    method: 'POST', body: JSON.stringify({ publishId, draftVersion }),
  })
export const publishStatus = (publishId: string) =>
  apiFetch<{ status: 'running' | 'done' | 'failed'; versionNo?: number; error?: { code: string; field?: string } }>(
    `/tenant/site-builder/publish/${encodeURIComponent(publishId)}`)
export const listVersions = () => apiFetch<{ versions: Version[] }>('/tenant/site-builder/versions')
export const rollback = (publishId: string, versionNo: number) =>
  apiFetch<{ publishId: string; status?: string }>('/tenant/site-builder/rollback', {
    method: 'POST', body: JSON.stringify({ publishId, versionNo }),
  })

export const BLOCK_LABEL: Record<BlockType, string> = {
  hero: 'Stor rubrik', text: 'Text', image: 'Bild', gallery: 'Bildgalleri', menu: 'Meny',
  openingHours: 'Öppettider', bookingCta: 'Boka bord', orderCta: 'Beställ mat', cateringCta: 'Catering', contact: 'Kontakt',
}

/** Knappblock som bara gäller med en viss funktion i planen (gästsajten döljer dem annars). */
const BLOCK_FEATURE: Partial<Record<BlockType, FeatureKey>> = {
  bookingCta: 'reservations', orderCta: 'ordering', cateringCta: 'catering',
}

/** Blocktyperna som går att lägga till med restaurangens plan. */
export function addableBlocks(tenant: Pick<Tenant, 'entitlements'> | null | undefined): BlockType[] {
  return (Object.keys(BLOCK_LABEL) as BlockType[]).filter((t) => {
    const feature = BLOCK_FEATURE[t]
    return !feature || Boolean(tenant?.entitlements?.features?.[feature])
  })
}

/** Vilka fält varje block har i redigeraren (resten är fasta, t.ex. menyn som hämtas live). */
export const BLOCK_FIELDS: Record<BlockType, ('heading' | 'text' | 'body' | 'label' | 'alt' | 'caption')[]> = {
  hero: ['heading', 'text'], text: ['heading', 'body'], image: ['alt', 'caption'], gallery: ['heading'],
  menu: ['heading'], openingHours: ['heading'], bookingCta: ['heading', 'text', 'label'],
  orderCta: ['heading', 'text', 'label'], cateringCta: ['heading', 'text', 'label'], contact: ['heading'],
}

export const FIELD_LABEL = { heading: 'Rubrik', text: 'Text', body: 'Text', label: 'Knapptext', alt: 'Bildtext för skärmläsare', caption: 'Bildtext' } as const
export const FIELD_MAX = { heading: 80, text: 240, body: 4000, label: 40, alt: 160, caption: 160 } as const

export const ERRORS: Record<string, string> = {
  schema_invalid: 'Något i ett block är fel ifyllt. Kolla det markerade blocket och spara igen.',
  doc_too_large: 'Webbplatsen har blivit för stor. Ta bort några block eller korta texterna.',
  invalid_link: 'En länk går till en sida som inte finns. Välj en annan sida.',
  unknown_image: 'En bild går inte att använda. Välj en av era egna bilder.',
  contrast_too_low: 'Färgerna är för svåra att läsa. Välj en mörkare eller ljusare färg.',
  changed_retry: 'Någon annan ändrade webbplatsen samtidigt. Nu syns det senaste. Spara igen om din ändring behövs.',
  publish_running: 'En publicering pågår redan. Vänta tills den är klar.',
  wrong_mode: 'Booqy sköter er webbplats, så den går inte att ändra här. Kontakta Booqy för ändringar.',
  render_missing: 'Sidan gick inte att bygga. Det är Booqys fel, inte ert. Försök igen.',
}

/**
 * Adresser som gästsajten redan använder själv (customer-front-end App.tsx)
 * och som API:t därför inte tar emot som sidadress (400 schema_invalid på
 * /pages/<i>/slug). Samma lista som application shared/features/site_builder.
 */
export const RESERVED_SLUGS = new Set([
  'meny', 'boka-bord', 'bokningsvillkor', 'bokning', 'bestall', 'bestallning', 'catering', 'om-oss',
  'kontakt', 'integritetspolicy', 'cookies', 'presentkort', 'ko', 'forhandsvisning', 'evenemang',
  'biljett', 'assets', 'v', 'releases', 'preview',
])

export const SLUG_ERROR = 'Adressen används redan, av en annan sida eller av webbplatsen själv (till exempel /meny). Välj en annan, till exempel /lunch.'

/** Var i dokumentet ett fel gäller ("/pages/1/blocks/2/heading") -> sidans och blockets index, eller sidans adress. */
export function locate(field: string | undefined): { page?: number; block?: number; slug?: boolean } {
  const m = /^\/pages\/(\d+)(?:\/blocks\/(\d+)|\/(slug)$)?/.exec(field ?? '')
  if (!m) return {}
  return { page: Number(m[1]), ...(m[2] !== undefined ? { block: Number(m[2]) } : {}), ...(m[3] ? { slug: true } : {}) }
}

/** Var en krock sitter ("pages.0.blocks.2.heading"), med blockets namn för meddelandet. */
export function conflictPlace(doc: SiteDoc, path: string): { name: string; page?: number; block?: number } {
  const at = locate(`/${path.split('.').join('/')}`)
  const page = at.page !== undefined ? doc.pages[at.page] : undefined
  const pageName = page ? `sidan ${page.title || 'Startsida'}` : null
  const block = page && at.block !== undefined ? page.blocks[at.block] : undefined
  if (block) return { name: `Blocket ${BLOCK_LABEL[block.type]} på ${pageName}`, page: at.page, block: at.block }
  if (pageName) return { name: pageName.charAt(0).toUpperCase() + pageName.slice(1), page: at.page }
  return { name: 'Samma del av webbplatsen' }
}

/** En ledig adress för en ny sida: aldrig en annan sidas eller sajtens egen. */
export function freeSlug(title: string, taken: string[]): string {
  const base = slugify(title)
  let slug = base
  for (let n = 2; taken.includes(slug) || RESERVED_SLUGS.has(slug); n += 1) slug = `${base}-${n}`
  return slug
}

export function newId(): string {
  return crypto.randomUUID()
}

export function blockId(type: BlockType, existing: Block[]): string {
  const base = type.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30) || 'block'
  let n = 1
  while (existing.some((b) => b.id === `${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function slugify(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40) || 'sida'
}

export function moveBlock(blocks: Block[], index: number, delta: number): Block[] {
  const target = index + delta
  if (target < 0 || target >= blocks.length) return blocks
  const next = [...blocks]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}
