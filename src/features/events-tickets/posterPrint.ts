import QRCode from 'qrcode'
import { tokens } from '@booqy/brand'

/** Affisch med QR-kod till evenemangssidan för dem som köper biljett i dörren (betalar i sin telefon). */

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function eventUrl(primaryDomain: string | null | undefined, eventId: string): string | null {
  return primaryDomain ? `https://${primaryDomain}/evenemang/${encodeURIComponent(eventId)}` : null
}

export async function printPoster(title: string, url: string): Promise<boolean> {
  const image = await QRCode.toDataURL(url, { margin: 1, width: 720, errorCorrectionLevel: 'M', color: { light: tokens.palette.snow } })
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>` +
      'body{font-family:system-ui,sans-serif;text-align:center;margin:3em}h1{font-size:2.4em;margin:0 0 0.5em}' +
      'img{width:70%;max-width:18em}p{font-size:1.4em}</style></head><body>' +
      `<h1>${escapeHtml(title)}</h1><img src="${image}" alt=""><p>Skanna för att köpa biljett</p></body></html>`,
  )
  win.document.close()
  win.focus()
  win.print()
  return true
}
