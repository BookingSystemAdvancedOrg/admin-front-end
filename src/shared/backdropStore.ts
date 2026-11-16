import { apiFetch, ApiError, isApiConfigured } from './api'
import {
  forgetBackdropImage,
  readGlassBackdrop,
  refreshBackdropImage,
  setBackdropImageSource,
  setGlassBackdrop,
} from './glassBackdrop'
import { withBusy } from './motion/busy'

/**
 * Egna bilder bakom glaset: ett bibliotek per användare på servern (upp till
 * MAX bilder). Varje uppladdning läggs till; en av dem är vald som bakgrund.
 * API: GET /me/backdrops, POST /me/backdrops/upload, POST
 * /me/backdrops/{id}/complete, PUT /me/backdrops/selected, DELETE
 * /me/backdrops/{id}. Utan API (lokal utveckling) ligger biblioteket i minnet.
 */

export type BackdropItem = {
  id: string
  url: string
  thumbUrl: string
  uploadedAt: string
  width: number
  height: number
}
export type Library = { items: BackdropItem[]; selectedId: string | null; max: number; loaded: boolean }
export type UploadError = 'not-image' | 'unreadable' | 'too-large' | 'limit' | 'failed'

export const MAX_SIDE = 2560
export const MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX = 20

let library: Library = { items: [], selectedId: null, max: DEFAULT_MAX, loaded: false }
const listeners = new Set<() => void>()

export function getLibrary(): Library {
  return library
}
export function subscribeLibrary(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function set(next: Partial<Library>) {
  library = { ...library, ...next }
  for (const fn of listeners) fn()
}

export function selectedItem(): BackdropItem | null {
  return library.items.find((i) => i.id === library.selectedId) ?? null
}

setBackdropImageSource(async () => {
  if (!library.loaded) await loadLibrary()
  return selectedItem()?.url ?? null
})

// --- server, eller minnet utan API ------------------------------------------------

const memory = { items: [] as BackdropItem[], selectedId: null as string | null }

export async function loadLibrary(): Promise<Library> {
  if (!isApiConfigured()) {
    set({ items: [...memory.items], selectedId: memory.selectedId, loaded: true })
    return library
  }
  try {
    const res = await apiFetch<{ items: BackdropItem[]; selectedId: string | null; max?: number }>('/me/backdrops')
    set({ items: res.items ?? [], selectedId: res.selectedId ?? null, max: res.max ?? DEFAULT_MAX, loaded: true })
  } catch {
    set({ loaded: true })
  }
  return library
}

/** Efter inloggning: läs biblioteket om Egen bild är valt på den här enheten. */
export function syncBackdropImage(): void {
  if (readGlassBackdrop().mode === 'image') void refreshBackdropImage()
}

async function shrink(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
  if (!blob) throw new Error('encode')
  return { blob, width, height }
}

/** Skickar formuläret till lagringen med förlopp (fetch har inget uppladdningsförlopp). */
function postWithProgress(url: string, form: FormData, onProgress: (share: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300)
    xhr.onerror = () => resolve(false)
    xhr.send(form)
  })
}

/** Lägger till en bild i biblioteket och väljer den som bakgrund. */
export async function uploadBackdrop(
  file: File,
  onProgress: (share: number) => void = () => {},
): Promise<UploadError | null> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return 'not-image'
  if (library.items.length >= library.max) return 'limit'
  return withBusy(async () => {
    let shrunk: Awaited<ReturnType<typeof shrink>>
    try {
      shrunk = await shrink(file)
    } catch {
      return 'unreadable' as const
    }
    if (shrunk.blob.size > MAX_BYTES) return 'too-large' as const
    onProgress(0)
    let item: BackdropItem
    if (!isApiConfigured()) {
      const url = URL.createObjectURL(shrunk.blob)
      item = { id: crypto.randomUUID(), url, thumbUrl: url, uploadedAt: new Date().toISOString(), width: shrunk.width, height: shrunk.height }
      memory.items = [item, ...memory.items]
      onProgress(1)
    } else {
      try {
        const post = await apiFetch<{ id: string; url: string; fields: Record<string, string> }>('/me/backdrops/upload', {
          method: 'POST',
          body: JSON.stringify({ contentType: 'image/jpeg', size: shrunk.blob.size, width: shrunk.width, height: shrunk.height }),
        })
        const form = new FormData()
        for (const [k, v] of Object.entries(post.fields)) form.append(k, v)
        form.append('file', shrunk.blob, 'backdrop.jpg')
        if (!(await postWithProgress(post.url, form, onProgress))) return 'failed' as const
        item = (await apiFetch<{ item: BackdropItem }>(`/me/backdrops/${encodeURIComponent(post.id)}/complete`, { method: 'POST' })).item
      } catch (err) {
        return err instanceof ApiError && err.status === 409 ? ('limit' as const) : ('failed' as const)
      }
      set({ items: [item, ...library.items.filter((i) => i.id !== item.id)] })
    }
    await selectBackdrop(item.id)
    return null
  })
}

/** Väljer en bild som bakgrund (null: ingen vald) och sveper in den. */
export async function selectBackdrop(id: string | null, origin?: { x: number; y: number }): Promise<boolean> {
  if (isApiConfigured()) {
    try {
      await apiFetch('/me/backdrops/selected', { method: 'PUT', body: JSON.stringify({ id }) })
    } catch {
      return false
    }
  } else {
    memory.selectedId = id
  }
  if (!isApiConfigured()) set({ items: [...memory.items] })
  set({ selectedId: id })
  if (id) {
    setGlassBackdrop({ mode: 'image' })
    await refreshBackdropImage(origin)
  } else {
    forgetBackdropImage()
    setGlassBackdrop({ mode: 'clear' }, origin)
  }
  return true
}

export async function deleteBackdrop(id: string): Promise<boolean> {
  const wasSelected = library.selectedId === id
  if (isApiConfigured()) {
    try {
      await withBusy(() => apiFetch(`/me/backdrops/${encodeURIComponent(id)}`, { method: 'DELETE' }))
    } catch {
      return false
    }
  } else {
    memory.items = memory.items.filter((i) => i.id !== id)
    if (memory.selectedId === id) memory.selectedId = null
  }
  set({ items: library.items.filter((i) => i.id !== id), selectedId: wasSelected ? null : library.selectedId })
  if (wasSelected) {
    forgetBackdropImage()
    setGlassBackdrop({ mode: 'clear' })
  }
  return true
}

// Bara i lokal utveckling: fyll biblioteket med provbilder (för skärmbilder och tester).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __booqySeedBackdrops?: (n: number) => void }).__booqySeedBackdrops = (n: number) => {
    const hues = [12, 28, 45, 95, 160, 200, 230, 280, 320, 350]
    memory.items = Array.from({ length: n }, (_, i) => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 400
      const g = c.getContext('2d')!
      const grad = g.createLinearGradient(0, 0, 640, 400)
      grad.addColorStop(0, `hsl(${hues[i % hues.length]} 55% 45%)`)
      grad.addColorStop(1, `hsl(${(hues[i % hues.length] + 40) % 360} 60% 70%)`)
      g.fillStyle = grad
      g.fillRect(0, 0, 640, 400)
      const url = c.toDataURL('image/jpeg', 0.8)
      return { id: `seed-${i}`, url, thumbUrl: url, uploadedAt: new Date(Date.now() - i * 3600e3).toISOString(), width: 640, height: 400 }
    })
    memory.selectedId = n ? 'seed-0' : null
    void loadLibrary()
  }
}
