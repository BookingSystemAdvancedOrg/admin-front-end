import { Avatar } from './Avatar'
import { ImageLightbox } from './ImageLightbox'

/**
 * Profilbilden i stort i samma glasruta som rätternas bilder (ImageLightbox).
 * Utan bild visas stora initialer. Namn och e-post står under. Ritas utanför
 * klickbara rader, som bildrutan i Meny.
 */
export function AvatarLightbox({ url, name, email, onClose }: { url?: string | null; name?: string | null; email?: string | null; onClose: () => void }) {
  const title = name?.trim() || email || 'Profilbild'
  return (
    <ImageLightbox alt={`Profilbild: ${title}`} onClose={onClose}>
      <figure className="avatar-lightbox">
        <Avatar url={url} name={name} email={email} size="xl" />
        <figcaption>
          <span className="avatar-lightbox-name">{title}</span>
          {name?.trim() && email && <span className="avatar-lightbox-email">{email}</span>}
        </figcaption>
      </figure>
    </ImageLightbox>
  )
}
