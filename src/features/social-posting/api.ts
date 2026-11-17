import { apiFetch } from '../../shared/api'

/** Inlägg på Facebook och Instagram (CONTRACTS.md 6.G). Bara för ägaren. */

export type Channel = 'facebook' | 'instagram'
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'partly_published' | 'failed' | 'cancelled'
export interface ChannelState {
  state: 'queued' | 'publishing' | 'published' | 'needs_check' | 'failed'
  metaPostId?: string
  permalink?: string
  publishedAt?: string
  lastError?: { code: string }
}
export interface Post {
  postId: string
  locationId: string
  source: { kind: 'dish' | 'special' | 'free'; menuItemId?: string }
  caption: string
  imageKey: string
  channels: Partial<Record<Channel, ChannelState>>
  status: PostStatus
  scheduledAt?: string
  alcoholConfirmed?: boolean
  version: number
}
export interface Listing {
  connection: { page?: string; instagram?: string; missingPermissions: Channel[] }
  posts: Post[]
}

const one = (id: string) => `/tenant/social-posts/${encodeURIComponent(id)}`

export const listPosts = () => apiFetch<Listing>('/tenant/social-posts')
export const draftsFromMenu = (locationId: string, menuItemIds: string[]) =>
  apiFetch<{ posts: Post[] }>('/tenant/social-posts/drafts', { method: 'POST', body: JSON.stringify({ locationId, menuItemIds }) })
export const updatePost = (p: Post, change: { caption?: string; channels?: Channel[]; alcoholConfirmed?: boolean }) =>
  apiFetch<Post>(one(p.postId), { method: 'PUT', body: JSON.stringify({ ...change, version: p.version }) })
export const schedulePost = (p: Post, when: { scheduledAt: string } | { now: true }) =>
  apiFetch<Post>(`${one(p.postId)}/schedule`, { method: 'POST', body: JSON.stringify({ ...when, version: p.version }) })
export const cancelPost = (p: Post) =>
  apiFetch<Post>(`${one(p.postId)}/cancel`, { method: 'POST', body: JSON.stringify({ version: p.version }) })
export const deletePost = (p: Post) => apiFetch<void>(one(p.postId), { method: 'DELETE' })

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Utkast', scheduled: 'Schemalagd', publishing: 'Publiceras…', published: 'Publicerad',
  partly_published: 'Delvis publicerad', failed: 'Misslyckades', cancelled: 'Avbruten',
}
export const CHANNEL_LABEL: Record<Channel, string> = { facebook: 'Facebook', instagram: 'Instagram' }

export const ERRORS: Record<string, string> = {
  meta_not_connected: 'Facebook och Instagram är inte kopplade än. Koppla dem först under Annonser.',
  meta_permission_missing: 'Booqy får inte publicera hos Meta än. Koppla Meta igen under Annonser.',
  alcohol_confirmation_required: 'Inlägget gäller en dryck med alkohol. Bocka i rutan om alkohollagen och försök igen.',
  invalid_schedule: 'Tiden går inte att använda. Välj en tid från nu och högst 90 dagar fram.',
  caption_too_long: 'Texten är för lång. Den får vara högst 2 000 tecken.',
  invalid_channels: 'Välj var inlägget ska synas: Facebook, Instagram eller båda.',
  invalid_state: 'Inlägget går inte att ändra just nu. Det kan redan vara publicerat.',
  image_not_allowed: 'Bilden går inte att använda. Välj en annan rätt med en annan bild.',
}

export const FAILED_LABEL: Record<string, string> = {
  meta_not_connected: 'Meta är inte kopplat. Koppla Meta under Annonser.',
  feature_not_in_plan: 'Inlägg ingår inte längre i ert abonnemang.',
  instagram_rate_limited: 'Instagram tar inte emot fler inlägg i dag. Försök igen i morgon.',
  meta_unavailable: 'Meta svarade inte. Det är inte ert fel. Försök igen.',
}

/** datetime-local (lokal tid) -> ISO UTC med Z, sekunder 00. */
export function toUtc(local: string): string {
  return new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z')
}
