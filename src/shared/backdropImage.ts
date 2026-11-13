import { apiFetch, isApiConfigured } from './api'
import { forgetBackdropImage, readGlassBackdrop, refreshBackdropImage, setBackdropImageSource, setGlassBackdrop } from './glassBackdrop'
import { withBusy } from './motion/busy'

/**
 * Egen bild bakom glaset, sparad på servern per användare (GET/POST/DELETE
 * /me/backdrop). Bilden förminskas i webbläsaren till högst 2560 px och skickas
 * som JPEG direkt till lagringen med en kortlivad, förhandsgodkänd adress.
 */

export const MAX_SIDE = 2560
export const MAX_BYTES = 10 * 1024 * 1024
export type UploadError = 'not-image' | 'unreadable' | 'too-large' | 'failed' | 'offline'

setBackdropImageSource(async () => {
  if (!isApiConfigured()) return null
  const res = await apiFetch<{ url: string | null }>('/me/backdrop')
  return typeof res?.url === 'string' && res.url ? res.url : null
})

/** Efter inloggning: hämta bilden om läget Egen bild är valt på den här enheten. */
export function syncBackdropImage(): void {
  if (readGlassBackdrop().mode === 'image') void refreshBackdropImage()
}

/** Skalar ner till högst MAX_SIDE och gör en JPEG. HEIC fungerar där webbläsaren kan läsa det (Safari). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
  if (!blob) throw new Error('encode')
  return blob
}

export async function uploadBackdropImage(file: File, origin?: { x: number; y: number }): Promise<UploadError | null> {
  if (!isApiConfigured()) return 'offline'
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return 'not-image'
  return withBusy(async () => {
    let blob: Blob
    try {
      blob = await shrink(file)
    } catch {
      return 'unreadable' as const
    }
    if (blob.size > MAX_BYTES) return 'too-large' as const
    try {
      const post = await apiFetch<{ url: string; fields: Record<string, string> }>('/me/backdrop/upload', {
        method: 'POST',
        body: JSON.stringify({ contentType: 'image/jpeg', size: blob.size }),
      })
      const form = new FormData()
      for (const [k, v] of Object.entries(post.fields)) form.append(k, v)
      form.append('file', blob, 'backdrop.jpg')
      const res = await fetch(post.url, { method: 'POST', body: form })
      if (!res.ok) return 'failed' as const
    } catch {
      return 'failed' as const
    }
    setGlassBackdrop({ mode: 'image' })
    return (await refreshBackdropImage(origin)) ? null : ('failed' as const)
  })
}

export async function removeBackdropImage(origin?: { x: number; y: number }): Promise<boolean> {
  try {
    await withBusy(() => apiFetch('/me/backdrop', { method: 'DELETE' }))
  } catch {
    return false
  }
  forgetBackdropImage()
  setGlassBackdrop({ mode: 'clear' }, origin)
  return true
}
