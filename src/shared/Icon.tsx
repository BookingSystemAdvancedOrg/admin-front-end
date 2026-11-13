/**
 * Adminens ikoner - aldrig emojis. Varje ikon ritas med currentColor och
 * följer därför textfärgen i ljust och mörkt läge.
 *
 * Ikoner från The Noun Project (NounPro, ingen attribution) läggs som
 * src/shared/icons/noun/<namn>.svg. Finns en sådan fil används den
 * automatiskt; annars den egna ritade ikonen nedan.
 */

export type IconName =
  | 'dish'
  | 'note'
  | 'card'
  | 'receipt'
  | 'check'
  | 'close'
  | 'circle'
  | 'trash'
  | 'calendar'
  | 'tool-select'
  | 'tool-hand'
  | 'tool-floor'
  | 'tool-wall'
  | 'tool-window'
  | 'tool-entrance'
  | 'tool-kitchen'
  | 'tool-checkout'
  | 'table-square'
  | 'table-round'
  | 'undo'
  | 'redo'
  | 'rotate'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'trend-up'
  | 'trend-down'
  | 'plus'
  | 'minus'
  | 'printer'
  | 'mail'
  | 'download'
  | 'home'
  | 'chart'
  | 'bag'
  | 'terminal'
  | 'register'
  | 'tray'
  | 'badge'
  | 'phone'
  | 'book'
  | 'users'
  | 'staff'
  | 'gift'
  | 'globe'
  | 'ticket'
  | 'megaphone'
  | 'gear'
  | 'help'
  | 'search'
  | 'send'
  | 'chevron-down'
  | 'logout'
  | 'menu'

// Egna ikoner, 24x24 med 1.8 px linje.
const DRAWN: Record<IconName, string> = {
  dish: '<path d="M3.5 17.5h17M5.5 17.5a6.5 6.5 0 0 1 13 0M12 11V8.5M10.4 8.5h3.2M7 20h10"/>',
  note: '<path d="M4 20h6M14.6 5.4l4 4L9.4 18.6H5.4v-4z"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10.2h18M7 14.6h3.5"/>',
  receipt: '<path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4zM9 8h6M9 11.5h6M9 15h3.5"/>',
  check: '<path d="M5 12.6l4.3 4.2L19 7.2"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  circle: '<circle cx="12" cy="12" r="5.5"/>',
  trash: '<path d="M4.5 7h15M10 7V4.8h4V7M6.8 7l1 12.6h8.4l1-12.6M10.4 11v5.5M13.6 11v5.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  'tool-select': '<path d="M6 4l12.5 7.2-5.4 1.4-2.7 5.4z"/>',
  'tool-hand':
    '<path d="M8 13.5V7a1.5 1.5 0 0 1 3 0v4.5M11 11V5.5a1.5 1.5 0 0 1 3 0v5.5M14 11V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.6a5.4 5.4 0 0 1-4.5-2.4L4.6 15.4a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
  'tool-floor': '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/>',
  'tool-wall': '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M3 12h18M9 7v5M15 12v5"/>',
  'tool-window': '<rect x="4.5" y="5" width="15" height="14" rx="1"/><path d="M12 5v14M4.5 12h15"/>',
  'tool-entrance': '<path d="M4 20h16M6.5 20V4h9.5v16M13.4 12.2v.1"/>',
  'tool-kitchen': '<path d="M5 11h14v5a3.5 3.5 0 0 1-3.5 3.5h-7A3.5 3.5 0 0 1 5 16zM3 11h18M9.5 4c-1 1 1 2 0 3.5M13.5 4c-1 1 1 2 0 3.5"/>',
  'tool-checkout': '<path d="M4 20h16M5.5 20l1-7.5h11l1 7.5M8.5 12.5V6h7v6.5M10.5 9h3"/>',
  'table-square': '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M9.5 3.5h5M9.5 20.5h5M3.5 9.5v5M20.5 9.5v5"/>',
  'table-round': '<circle cx="12" cy="12" r="5.5"/><path d="M10 3.5h4M10 20.5h4M3.5 10v4M20.5 10v4"/>',
  undo: '<path d="M8.5 6L4.5 10l4 4M4.5 10h9.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15.5 6l4 4-4 4M19.5 10H10a5.5 5.5 0 0 0 0 11h3"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6"/>',
  'arrow-up': '<path d="M12 19.5V5M6.5 10.5L12 5l5.5 5.5"/>',
  'arrow-down': '<path d="M12 4.5V19M6.5 13.5L12 19l5.5-5.5"/>',
  'arrow-right': '<path d="M4.5 12H19M13.5 6.5L19 12l-5.5 5.5"/>',
  'trend-up': '<path d="M3.5 17.5l6-6 4 4 7-7.5M15 8h5.5v5.5"/>',
  'trend-down': '<path d="M3.5 6.5l6 6 4-4 7 7.5M15 16h5.5v-5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  printer: '<path d="M7 9V4h10v5M7 17H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 9h14a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 19 17h-2M7 14h10v6H7z"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z"/>',
  chart: '<path d="M4 20h16M6.5 20v-6M11 20V9M15.5 20v-8M20 20V5"/>',
  bag: '<path d="M5 8h14l-1 12.5H6zM9 8V6.5a3 3 0 0 1 6 0V8"/>',
  terminal: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9 7.5h6M9 11.5h.01M12 11.5h.01M15 11.5h.01M9 15h.01M12 15h.01M15 15h.01"/>',
  register: '<path d="M4 20h16M5.5 20l1-8h11l1 8M8 12V5h8v7M10 8h4"/>',
  tray: '<path d="M3.5 16.5h17M5 16.5a7 7 0 0 1 14 0M12 9.5V7.5M5 20h14"/>',
  badge: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M9.5 3v4h5V3M9 14.5a3 3 0 0 1 6 0M12 11.5h.01"/>',
  phone: '<path d="M6.5 4h3l1.5 4-2 1.2a10 10 0 0 0 5.8 5.8l1.2-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/>',
  book: '<path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h11M9 8.5h5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.2a5.5 5.5 0 0 1 3 5.3"/>',
  staff: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5a7 7 0 0 1 14 0M9.5 14.5l2.5 3 2.5-3"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3.5 9h17M12 9v11M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9zM12 9c1.5-3.5 5.5-4 5.5-1.5S14 9 12 9z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5z"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7.5v1.5M14 11.2v1.6M14 15v1.5"/>',
  megaphone: '<path d="M4 10v4h3l7 4V6L7 10zM17.5 9.5a3.5 3.5 0 0 1 0 5M7 14l1.5 5.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5M12 17h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
  send: '<path d="M20.5 3.5L3.5 10.8l6.6 2.6 2.6 6.6zM20.5 3.5l-10.4 9.9"/>',
  'chevron-down': '<path d="M6.5 9.5L12 15l5.5-5.5"/>',
  logout: '<path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14M10 12h10M16.5 8.5L20 12l-3.5 3.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
}

// Noun Project-filer som finns i repot (läses in vid bygget).
const NOUN = import.meta.glob('./icons/noun/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** En nedladdad SVG: utan "Created by"-text och fasta färger, så att den följer textfärgen. */
function nounInner(name: IconName): { inner: string; viewBox: string } | null {
  const raw = NOUN[`./icons/noun/${name}.svg`]
  if (!raw) return null
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 100 100'
  const inner = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<text[\s\S]*?<\/text>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/\s(fill|stroke)="(?!none)[^"]*"/g, ' $1="currentColor"')
  return { inner, viewBox }
}

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const noun = nounInner(name)
  if (noun) {
    return (
      <svg
        className={`icon ${className ?? ''}`}
        viewBox={noun.viewBox}
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
        dangerouslySetInnerHTML={{ __html: noun.inner }}
      />
    )
  }
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: DRAWN[name] }}
    />
  )
}
