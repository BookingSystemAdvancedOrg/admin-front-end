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
  meta_not_connected: 'Koppla Facebook och Instagram först (under Annonser).',
  meta_permission_missing: 'Kopplingen saknar behörighet att publicera. Koppla Meta igen under Annonser.',
  alcohol_confirmation_required: 'Bekräfta att inlägget om drycken följer alkohollagen innan det publiceras.',
  invalid_schedule: 'Välj en tid från nu och högst 90 dagar fram.',
  caption_too_long: 'Texten får vara högst 2 000 tecken.',
  invalid_channels: 'Välj Facebook, Instagram eller båda.',
  invalid_state: 'Inlägget kan inte ändras just nu.',
  image_not_allowed: 'Bilden kan inte användas.',
}

export const FAILED_LABEL: Record<string, string> = {
  meta_not_connected: 'Meta är inte kopplat.',
  feature_not_in_plan: 'Inlägg ingår inte längre i er plan.',
  instagram_rate_limited: 'Instagram tar inte emot fler inlägg i dag. Försök i morgon.',
  meta_unavailable: 'Meta svarade inte. Försök igen.',
}

/** datetime-local (lokal tid) -> ISO UTC med Z, sekunder 00. */
export function toUtc(local: string): string {
  return new Date(local).toISOString().replace(/\.\d{3}Z$/, 'Z')
}
