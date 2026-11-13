import { useState } from 'react'
import { initials } from './avatarStore'

/** En rund profilbild, eller initialer på en glascirkel när det inte finns någon (eller den inte laddar). */
export function Avatar({ url, name, email, size = 'md' }: { url?: string | null; name?: string | null; email?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState<string | null>(null)
  const show = url && broken !== url
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {show ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(url)} /> : <span className="avatar-initials">{initials(name, email)}</span>}
    </span>
  )
}
