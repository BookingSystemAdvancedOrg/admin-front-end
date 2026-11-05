import { MENU_IMAGE_CONTENT_TYPES, uploadMenuImage, type MenuImageContentType } from '../meny/menuApi'

/** Evenemangets bild (ADR-K 1): samma uppladdning som menybilderna, ingen egen lagring. */

/** Största bildfil vi tar emot (presigned-uppladdningen sätter ingen gräns själv). */
export const EVENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const EVENT_IMAGE_ALT_MAX = 200

/**
 * Evenemangets bild: en sparad nyckel (från menybildsuppladdningen) eller en
 * nyvald fil som laddas upp när evenemanget sparas, plus alt-text för
 * skärmläsare (krävs när det finns en bild).
 */
export interface EventImage {
  key: string | null
  file: File | null
  alt: string
}

export function initialImage(existing?: { imageKey?: string; imageAlt?: string }): EventImage {
  return { key: existing?.imageKey ?? null, file: null, alt: existing?.imageAlt ?? '' }
}

/** Ett fel att visa innan något skickas, eller null. */
export function imageFileError(file: File): string | null {
  if (!MENU_IMAGE_CONTENT_TYPES.includes(file.type as MenuImageContentType)) {
    return 'Bilden måste vara AVIF, JPEG, PNG eller WebP.'
  }
  if (file.size > EVENT_IMAGE_MAX_BYTES) return 'Bilden får vara högst 5 MB.'
  return null
}

export function imageAltError(image: EventImage): string | null {
  if (!image.key && !image.file) return null
  if (!image.alt.trim()) return 'Beskriv bilden för den som inte ser den.'
  return null
}

/**
 * imageKey och imageAlt att skicka med evenemanget: laddar först upp en
 * nyvald fil (samma uppladdning som menybilderna, nyckeln hör till platsen).
 * Ingen bild = inga fält, så servern tar bort en tidigare bild.
 * Nyckeln används först när uppladdningen lyckats; `onUploaded` låter anroparen
 * spara den direkt, så att ett misslyckat sparande inte laddar upp bilden igen.
 */
export async function imageFields(
  locationId: string, image: EventImage, onUploaded?: (key: string) => void,
): Promise<{ imageKey?: string; imageAlt?: string }> {
  let key = image.key
  if (image.file) {
    key = await uploadMenuImage(locationId, image.file)
    onUploaded?.(key)
  }
  return key ? { imageKey: key, imageAlt: image.alt.trim() } : {}
}
