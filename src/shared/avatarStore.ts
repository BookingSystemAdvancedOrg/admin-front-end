import { apiFetch, isApiConfigured } from './api'
import { withBusy } from './motion/busy'

/**
 * Profilbild, frivillig. Den inloggade väljer en bild och flyttar den i en
 * kvadrat (cropSquare); servern gör en 256 px WebP. Man ändrar bara sin egen;
 * en ägare får ta bort en anställds. Utan bild visas initialerna.
 * Utan API (lokal utveckling) ligger bilden bara i minnet.
 */

let mine: { url: string | null; loaded: boolean } = { url: null, loaded: false }
const listeners = new Set<() => void>()

export function getMyAvatar() {
  return mine
}
export function subscribeMyAvatar(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function set(url: string | null) {
  mine = { url, loaded: true }
  for (const fn of listeners) fn()
}

export async function loadMyAvatar(): Promise<void> {
  if (!isApiConfigured()) return set(mine.url)
  try {
    set((await apiFetch<{ url: string | null }>('/me/avatar')).url ?? null)
  } catch {
    set(null)
  }
}

/** Initialer: för- och efternamnets första bokstav, ett namns första, annars e-postens första. */
export function initials(name?: string | null, email?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (email ?? '?').trim().charAt(0).toUpperCase() || '?'
}

export type Crop = { x: number; y: number; scale: number }

/** Bildens läge i en kvadrat med sidan `view`: täcker alltid kvadraten (gånger zoom). */
export function coverCrop(width: number, height: number, view: number, zoom: number, dx: number, dy: number): Crop {
  const scale = Math.max(view / width, view / height) * Math.max(1, zoom)
  const w = width * scale
  const h = height * scale
  const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v))
  return { scale, x: clamp((view - w) / 2 + dx, view - w), y: clamp((view - h) / 2 + dy, view - h) }
}

/** Ritar den valda kvadraten som en JPEG på `size` px. */
export async function cropSquare(img: HTMLImageElement, crop: Crop, view: number, size = 512): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  const k = size / view
  ctx.drawImage(img, crop.x * k, crop.y * k, img.naturalWidth * crop.scale * k, img.naturalHeight * crop.scale * k)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('encode')
  return blob
}

export async function saveMyAvatar(blob: Blob): Promise<boolean> {
  if (!isApiConfigured()) {
    set(URL.createObjectURL(blob))
    return true
  }
  return withBusy(async () => {
    try {
      const post = await apiFetch<{ url: string; fields: Record<string, string> }>('/me/avatar/upload', {
        method: 'POST',
        body: JSON.stringify({ contentType: 'image/jpeg', size: blob.size }),
      })
      const form = new FormData()
      for (const [k, v] of Object.entries(post.fields)) form.append(k, v)
      form.append('file', blob, 'avatar.jpg')
      const res = await fetch(post.url, { method: 'POST', body: form })
      if (!res.ok) return false
      set((await apiFetch<{ url: string }>('/me/avatar/complete', { method: 'POST' })).url)
      return true
    } catch {
      return false
    }
  })
}

export async function removeMyAvatar(): Promise<boolean> {
  if (isApiConfigured()) {
    try {
      await withBusy(() => apiFetch('/me/avatar', { method: 'DELETE' }))
    } catch {
      return false
    }
  }
  set(null)
  return true
}

/** Ägaren tar bort en anställds profilbild (servern kollar roll och restaurang). */
export async function removeUserAvatar(sub: string): Promise<boolean> {
  if (!isApiConfigured()) return true
  try {
    await withBusy(() => apiFetch(`/users/${encodeURIComponent(sub)}/avatar`, { method: 'DELETE' }))
    return true
  } catch {
    return false
  }
}
