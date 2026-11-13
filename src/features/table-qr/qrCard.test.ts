import { describe, expect, it } from 'vitest'
import { cardPdf, cardSvg, fileName, fitSize, sheetPdf, sheetSvgs, textWidth } from './qrCard'

const card = { title: 'Bord 7', restaurant: 'Roma Södermalm', url: 'https://roma.booqy.se/bestall?bord=abcdefghijklmnopqrstuv' }

async function text(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('')
}

describe('qrCard', () => {
  it('draws the card with the table, restaurant and a QR code', () => {
    const svg = cardSvg(card)
    expect(svg).toContain('width="105mm"')
    expect(svg).toContain('>Bord 7<')
    expect(svg).toContain('>Roma Södermalm<')
    expect(svg).toContain('Skanna, beställ och betala i mobilen')
    expect(svg).toMatch(/<path d="M[\d.]+ [\d.]+h/)
    expect(svg).not.toMatch(/#fff\b|#ffffff/i)
  })

  it('escapes names and shrinks long ones to fit', () => {
    expect(cardSvg({ ...card, restaurant: '<Kalle & Co>' })).toContain('&#60;Kalle &#38; Co&#62;')
    const long = 'Bordet längst in vid fönstret mot gården'
    const size = fitSize(long, 36, 89, true)
    expect(size).toBeLessThan(36)
    expect(textWidth(long, size, true)).toBeLessThanOrEqual(89.01)
  })

  it('puts four cards on each A4 sheet', () => {
    expect(sheetSvgs(Array(5).fill(card))).toHaveLength(2)
  })

  it('writes a valid PDF: one A6 page per card, four per A4 on the sheet', async () => {
    const one = await text(cardPdf(card))
    expect(one.startsWith('%PDF-1.4')).toBe(true)
    expect(one.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(one).toContain('/MediaBox [0 0 297.64 419.53]')
    expect(one).toContain('(Bord 7) Tj')
    // xref offsets point at the objects.
    const xref = Number(one.match(/startxref\n(\d+)/)?.[1])
    expect(one.slice(xref, xref + 4)).toBe('xref')
    const first = one.match(/\n(\d{10}) 00000 n /)?.[1]
    expect(one.slice(Number(first), Number(first) + 7)).toBe('1 0 obj')
    const sheet = await text(sheetPdf(Array(6).fill(card), 'QR-koder'))
    expect(sheet).toContain('/Count 2')
    expect(sheet.match(/\/MediaBox \[0 0 595.28 841.89\]/g)).toHaveLength(2)
  })

  it('names files after the table', () => {
    expect(fileName('Bord 7', 'pdf')).toBe('qr-bord-7.pdf')
    expect(fileName('Fönsterbordet', 'png')).toBe('qr-fonsterbordet.png')
  })
})
