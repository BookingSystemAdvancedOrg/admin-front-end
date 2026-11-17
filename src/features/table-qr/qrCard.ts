import QRCode from 'qrcode'
import { tokens } from '@booqy/brand'

/**
 * Bordskortet med QR-koden, i Booqys utseende: vinröd list med restaurangens
 * namn, bordets namn stort, QR-koden och en rad om vad gästen gör.
 *
 * Ett kort är A6 (105 x 148 mm); utskriftsarket lägger fyra kort på en A4
 * med skärlinjer. Samma layout blir SVG, PNG och PDF. PDF:en skrivs här
 * (vektor: QR-kodens moduler är rektanglar, så den blir skarp i alla
 * storlekar) med PDF:ens inbyggda Helvetica, utan något bibliotek.
 */

export interface QrCard {
  /** "Bord 7" eller bordets eget namn. */
  title: string
  /** Restaurangens namn (och platsens, när den har flera). */
  restaurant: string
  /** Adressen i QR-koden. */
  url: string
}

export const CARD_W = 105
export const CARD_H = 148
const SHEET_W = 210
const SHEET_H = 297

const INK = tokens.palette.espresso
const WINE = tokens.palette.wine
const PAPER = tokens.palette.snow
const MUTED = tokens.palette.graphite
const TAN = tokens.palette.bronze
export const HINT = 'Skanna, beställ och betala i mobilen'

/* Helvetica-breddernas AFM-värden (tusendelar av teckenstorleken) för tecken
   32-126; å/ä/ö räknas som a/o. Används för att centrera och krympa texten. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667,
  556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556,
  556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722,
  500, 500, 500, 334, 260, 334, 584,
]
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722,
  611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556,
  611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778,
  556, 556, 500, 389, 280, 389, 584,
]
const BASE: Record<string, string> = { å: 'a', ä: 'a', ö: 'o', Å: 'A', Ä: 'A', Ö: 'O', é: 'e', É: 'E', ü: 'u', Ü: 'U' }

/** Textens bredd i mm vid `size` pt. */
export function textWidth(text: string, size: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA
  let units = 0
  for (const ch of text) {
    const code = (BASE[ch] ?? ch).charCodeAt(0)
    units += code >= 32 && code <= 126 ? table[code - 32] : 556
  }
  return (units / 1000) * size * (25.4 / 72)
}

/** Största storlek (högst `max` pt) som får plats på `width` mm. */
export function fitSize(text: string, max: number, width: number, bold: boolean): number {
  const w = textWidth(text, max, bold)
  return w <= width ? max : Math.max(6, Math.floor((max * width) / w * 10) / 10)
}

interface Run {
  x: number
  y: number
  w: number
}

/** QR-kodens mörka moduler som vågräta rader (färre rektanglar). */
export function qrRuns(url: string): { size: number; runs: Run[] } {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const size = modules.size
  const runs: Run[] = []
  for (let y = 0; y < size; y++) {
    let start = -1
    for (let x = 0; x <= size; x++) {
      const dark = x < size && modules.data[y * size + x]
      if (dark && start < 0) start = x
      if (!dark && start >= 0) {
        runs.push({ x: start, y, w: x - start })
        start = -1
      }
    }
  }
  return { size, runs }
}

/* Kortets mått i mm (överkant = 0). */
const BAND_H = 28
const QR_SIZE = 68
const QR_TOP = 58
const TEXT_W = CARD_W - 16

interface Layout {
  name: { text: string; size: number }
  title: { text: string; size: number }
  qr: { size: number; runs: Run[]; module: number; left: number }
}

function layout(card: QrCard): Layout {
  const name = card.restaurant.trim() || 'Restaurangen'
  const qr = qrRuns(card.url)
  return {
    name: { text: name, size: fitSize(name, 14, TEXT_W, true) },
    title: { text: card.title, size: fitSize(card.title, 36, TEXT_W, true) },
    qr: { ...qr, module: QR_SIZE / qr.size, left: (CARD_W - QR_SIZE) / 2 },
  }
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const pt = (size: number) => size * (25.4 / 72)

/** Kortets SVG (mm-koordinater, 105 x 148). `x`/`y` flyttar det på ett ark. */
function cardGroup(card: QrCard, x = 0, y = 0): string {
  const l = layout(card)
  const m = l.qr.module
  const path = l.qr.runs
    .map((r) => `M${(l.qr.left + r.x * m).toFixed(3)} ${(QR_TOP + r.y * m).toFixed(3)}h${(r.w * m).toFixed(3)}v${m.toFixed(3)}h${(-r.w * m).toFixed(3)}z`)
    .join('')
  const font = `font-family="Helvetica, Arial, sans-serif" text-anchor="middle"`
  return (
    `<g transform="translate(${x} ${y})">` +
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${PAPER}"/>` +
    `<rect width="${CARD_W}" height="${BAND_H}" fill="${WINE}"/>` +
    `<text x="${CARD_W / 2}" y="${BAND_H / 2 + pt(l.name.size) * 0.35}" ${font} font-weight="700" font-size="${pt(l.name.size).toFixed(2)}" fill="${PAPER}">${escapeXml(l.name.text)}</text>` +
    `<text x="${CARD_W / 2}" y="${BAND_H + 21}" ${font} font-weight="700" font-size="${pt(l.title.size).toFixed(2)}" fill="${WINE}">${escapeXml(l.title.text)}</text>` +
    `<path d="${path}" fill="${INK}"/>` +
    `<text x="${CARD_W / 2}" y="${QR_TOP + QR_SIZE + 10}" ${font} font-size="${pt(9.5).toFixed(2)}" fill="${MUTED}">${escapeXml(HINT)}</text>` +
    `<text x="${CARD_W / 2}" y="${CARD_H - 6}" ${font} font-weight="700" font-size="${pt(7).toFixed(2)}" letter-spacing="0.6" fill="${TAN}">booqy</text>` +
    `</g>`
  )
}

/** Ett kort som fristående SVG-fil. */
export function cardSvg(card: QrCard): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}mm" height="${CARD_H}mm" viewBox="0 0 ${CARD_W} ${CARD_H}">` +
    `<title>${escapeXml(`${card.title} - ${card.restaurant}`)}</title>${cardGroup(card)}</svg>`
  )
}

/** Fyra kort per A4 med streckade skärlinjer; en SVG per sida. */
export function sheetSvgs(cards: QrCard[]): string[] {
  const pages: string[] = []
  for (let i = 0; i < cards.length; i += 4) {
    const groups = cards
      .slice(i, i + 4)
      .map((c, j) => cardGroup(c, (j % 2) * CARD_W, Math.floor(j / 2) * (SHEET_H / 2)))
      .join('')
    const cut = `stroke="${tokens.palette.sand}" stroke-width="0.25" stroke-dasharray="2 2"`
    pages.push(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" width="${SHEET_W}mm" height="${SHEET_H}mm">` +
        `<rect width="${SHEET_W}" height="${SHEET_H}" fill="${PAPER}"/>${groups}` +
        `<line x1="${CARD_W}" y1="0" x2="${CARD_W}" y2="${SHEET_H}" ${cut}/>` +
        `<line x1="0" y1="${SHEET_H / 2}" x2="${SHEET_W}" y2="${SHEET_H / 2}" ${cut}/></svg>`,
    )
  }
  return pages
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Kortet som PNG (300 dpi). */
export async function cardPng(card: QrCard, pxPerMm = 11.82): Promise<Blob> {
  const image = new Image()
  image.src = svgDataUrl(cardSvg(card))
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(CARD_W * pxPerMm)
  canvas.height = Math.round(CARD_H * pxPerMm)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('png'))), 'image/png'),
  )
}

/* --- PDF ------------------------------------------------------------------- */

const MM = 72 / 25.4

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => (c / 255).toFixed(3)).join(' ')
}

/** PDF-sträng i WinAnsi (latin-1); tecken utanför blir '?'. */
function pdfText(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    const c = code > 255 || ch.length > 1 ? '?' : ch
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c
  }
  return `(${out})`
}

/** Ritkommandon för ett kort med övre vänstra hörnet i (x, y) mm på en sida som är `pageH` mm hög. */
function cardOps(card: QrCard, x: number, y: number, pageH: number): string {
  const l = layout(card)
  const X = (mm: number) => ((x + mm) * MM).toFixed(2)
  const Y = (mm: number) => ((pageH - y - mm) * MM).toFixed(2)
  const ops: string[] = []
  const rect = (rx: number, ry: number, w: number, h: number) =>
    `${X(rx)} ${Y(ry + h)} ${(w * MM).toFixed(2)} ${(h * MM).toFixed(2)} re`
  const centred = (text: string, size: number, bold: boolean, baseline: number, color: string) => {
    const left = (CARD_W - textWidth(text, size, bold)) / 2
    ops.push(`${rgb(color)} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${X(left)} ${Y(baseline)} Td ${pdfText(text)} Tj ET`)
  }
  ops.push(`${rgb(PAPER)} rg ${rect(0, 0, CARD_W, CARD_H)} f`)
  ops.push(`${rgb(WINE)} rg ${rect(0, 0, CARD_W, BAND_H)} f`)
  centred(l.name.text, l.name.size, true, BAND_H / 2 + pt(l.name.size) * 0.35, PAPER)
  centred(l.title.text, l.title.size, true, BAND_H + 21, WINE)
  const m = l.qr.module
  ops.push(`${rgb(INK)} rg`)
  for (const r of l.qr.runs) ops.push(rect(l.qr.left + r.x * m, QR_TOP + r.y * m, r.w * m, m))
  ops.push('f')
  centred(HINT, 9.5, false, QR_TOP + QR_SIZE + 10, MUTED)
  centred('booqy', 7, true, CARD_H - 6, TAN)
  return ops.join('\n')
}

function buildPdf(pages: { w: number; h: number; ops: string }[], title: string): Blob {
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // objekt n = index + 1
  add('<< /Type /Catalog /Pages 2 0 R >>')
  const firstPage = 6
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ')
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  add(`<< /Title ${pdfText(title)} /Producer (Booqy) >>`)
  pages.forEach((page, i) => {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(page.w * MM).toFixed(2)} ${(page.h * MM).toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`,
    )
    add(`<< /Length ${page.ops.length} >>\nstream\n${page.ops}\nendstream`)
  })
  let out = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Allt är latin-1: ett tecken = en byte, så offseten ovan stämmer.
  const bytes = new Uint8Array(out.length)
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255
  return new Blob([bytes], { type: 'application/pdf' })
}

/** Ett kort per A6-sida. */
export function cardPdf(card: QrCard): Blob {
  return buildPdf([{ w: CARD_W, h: CARD_H, ops: cardOps(card, 0, 0, CARD_H) }], `${card.title} - ${card.restaurant}`)
}

/** Alla kort, fyra per A4 med skärlinjer. */
export function sheetPdf(cards: QrCard[], title: string): Blob {
  const pages = []
  for (let i = 0; i < cards.length; i += 4) {
    const ops = cards
      .slice(i, i + 4)
      .map((c, j) => cardOps(c, (j % 2) * CARD_W, Math.floor(j / 2) * (SHEET_H / 2), SHEET_H))
    const cut =
      `${rgb(tokens.palette.sand)} RG 0.7 w [5.7 5.7] 0 d ` +
      `${(CARD_W * MM).toFixed(2)} 0 m ${(CARD_W * MM).toFixed(2)} ${(SHEET_H * MM).toFixed(2)} l S ` +
      `0 ${((SHEET_H / 2) * MM).toFixed(2)} m ${(SHEET_W * MM).toFixed(2)} ${((SHEET_H / 2) * MM).toFixed(2)} l S`
    pages.push({ w: SHEET_W, h: SHEET_H, ops: [...ops, cut].join('\n') })
  }
  return buildPdf(pages, title)
}

/** Filnamn som "qr-bord-7.pdf". */
export function fileName(title: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `qr-${slug || 'bord'}.${ext}`
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Skriv ut korten: ett kort per A6, eller fyra per A4 (ark). */
export function printCards(cards: QrCard[], title: string): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  const single = cards.length === 1
  const pages = single ? [cardSvg(cards[0])] : sheetSvgs(cards)
  const size = single ? 'A6' : 'A4'
  win.document.write(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>` +
      `@page{size:${size};margin:0}html,body{margin:0;background:${PAPER}}` +
      `svg{display:block;width:${single ? CARD_W : SHEET_W}mm;height:${single ? CARD_H : SHEET_H}mm;break-after:page}` +
      `svg:last-child{break-after:auto}</style></head><body>${pages.join('')}</body></html>`,
  )
  win.document.close()
  win.focus()
  win.print()
  return true
}
