// Rendu PDF/A-3b d'une facture Potentieel + XML Factur-X (EN 16931) embarqué.
// pdfkit gère nativement PDF/A-3 (profil ICC, XMP) et la pièce jointe « Alternative ».
// PDF/A exige des polices incluses : Arimo (licence OFL, métriques d'Helvetica).
import PDFDocument from 'npm:pdfkit@0.19.1'
import { Buffer } from 'node:buffer'
import { FACTURX_XMP, FACTURX_XML_FILENAME } from './xmp.ts'
import { fmtDateFr, REGLEMENTS, sirenLabel, type Built, type FactureRow } from './model.ts'

const FONT_URLS: Record<string, string[]> = {
  reg: [
    'https://potentieel.fr/assets/fonts/Arimo-Regular.ttf',
    'https://raw.githubusercontent.com/googlefonts/arimo/main/fonts/ttf/Arimo-Regular.ttf',
  ],
  bold: [
    'https://potentieel.fr/assets/fonts/Arimo-Bold.ttf',
    'https://raw.githubusercontent.com/googlefonts/arimo/main/fonts/ttf/Arimo-Bold.ttf',
  ],
}
let fontCache: { reg: Buffer; bold: Buffer } | null = null
async function loadFonts() {
  if (fontCache) return fontCache
  const get = async (urls: string[]) => {
    for (const u of urls) {
      try {
        const r = await fetch(u)
        if (r.ok) return Buffer.from(await r.arrayBuffer())
      } catch { /* source suivante */ }
    }
    throw new Error('Police Arimo introuvable')
  }
  fontCache = { reg: await get(FONT_URLS.reg), bold: await get(FONT_URLS.bold) }
  return fontCache
}

const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ') + ' €'
const qty = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 4 })

// PDF/A interdit un glyphe absent de la police : on retire émojis et symboles non couverts.
function safe(s: string): string {
  return String(s ?? '')
    .replace(/[‘’]/g, '’')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/ /g, ' ')
}

const ACCENT = '#f4926a'
const INK = '#111111'
const GREY = '#666666'
const LINE = '#e5e7eb'

export async function renderFacturePdf(f: FactureRow, built: Built, xml: string, numero: string, issueDate: string): Promise<Uint8Array> {
  const fonts = await loadFonts()
  const ent = built.entite
  const m = built.model
  const isAvoir = f.type === 'avoir'
  const now = new Date()

  const doc = new PDFDocument({
    size: 'A4', margin: 48, pdfVersion: '1.7', subset: 'PDF/A-3b', lang: 'fr-FR',
    font: fonts.reg as unknown as string,
    info: { Title: `${isAvoir ? 'Avoir' : 'Facture'} ${numero}`, Author: ent.nomLegal, Creator: 'Potentieel', Producer: 'Potentieel', CreationDate: now },
  } as Record<string, unknown>)
  doc.registerFont('R', fonts.reg)
  doc.registerFont('B', fonts.bold)
  const chunks: Uint8Array[] = []
  doc.on('data', (c: Uint8Array) => chunks.push(c))
  const done = new Promise<void>((res, rej) => { doc.on('end', () => res()); doc.on('error', rej) })

  const W = doc.page.width, ML = 48, CW = W - 2 * ML
  const T = (font: 'R' | 'B', size: number, color: string) => doc.font(font).fontSize(size).fillColor(color)

  // ── Bandeau ──
  doc.rect(0, 0, W, 104).fill(INK)
  T('B', 20, '#ffffff').text('POTENTIEEL', ML, 40, { characterSpacing: 2 })
  T('R', 9, '#bbbbbb').text('Sites internet & acquisition locale', ML, 66)
  T('B', 22, ACCENT).text(isAvoir ? 'AVOIR' : 'FACTURE', ML, 30, { width: CW, align: 'right' })
  T('R', 9.5, '#ffffff').text(`N° ${numero}`, ML, 58, { width: CW, align: 'right' })
  T('R', 9, '#bbbbbb').text(`Émise le ${fmtDateFr(issueDate)}`, ML, 72, { width: CW, align: 'right' })
  if (built.paid) T('B', 9, '#4ade80').text(`Acquittée le ${fmtDateFr(f.date_paiement)}`, ML, 85, { width: CW, align: 'right' })

  // ── Prestataire / Client ──
  let y = 128
  const boxW = (CW - 14) / 2
  const sellerLines = [
    `${ent.forme} — micro-entreprise`,
    ent.adresse,
    `SIREN ${sirenLabel(ent.siren)} · SIRET ${ent.siret.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4')}`,
    `${ent.rcs} · TVA non applicable (art. 293 B du CGI)`,
    `${ent.email} · ${ent.site}`,
  ]
  const cl = f.client || {}
  const clientLines = [
    cl.adresse || '',
    m.buyer.siren ? `SIREN ${sirenLabel(m.buyer.siren)}` : '',
    cl.email || '',
    cl.tel || '',
  ].filter(Boolean)
  const boxH = 112
  doc.roundedRect(ML, y, boxW, boxH, 8).lineWidth(1).strokeColor(ACCENT).stroke()
  doc.roundedRect(ML + boxW + 14, y, boxW, boxH, 8).lineWidth(1).strokeColor(LINE).stroke()
  T('B', 7.5, ACCENT).text('PRESTATAIRE', ML + 12, y + 11)
  T('B', 10.5, INK).text(safe(ent.nomLegal), ML + 12, y + 24, { width: boxW - 24 })
  T('R', 8, GREY).text(sellerLines.map(safe).join('\n'), ML + 12, doc.y + 3, { width: boxW - 24, lineGap: 1.5 })
  const cx = ML + boxW + 14
  T('B', 7.5, GREY).text('CLIENT', cx + 12, y + 11)
  T('B', 10.5, INK).text(safe(cl.nom || 'Client'), cx + 12, y + 24, { width: boxW - 24 })
  T('R', 8, GREY).text(clientLines.map(safe).join('\n'), cx + 12, doc.y + 3, { width: boxW - 24, lineGap: 1.5 })
  y += boxH + 22

  // ── Tableau ──
  const colQ = 52, colPU = 82, colM = 92
  const colD = CW - colQ - colPU - colM
  doc.rect(ML, y, CW, 24).fill(ACCENT)
  T('B', 8.5, '#ffffff')
  doc.text('PRESTATION', ML + 10, y + 8, { width: colD - 10 })
  doc.text('QTÉ', ML + colD, y + 8, { width: colQ, align: 'right' })
  doc.text('PRIX UNIT.', ML + colD + colQ, y + 8, { width: colPU, align: 'right' })
  doc.text('MONTANT', ML + colD + colQ + colPU, y + 8, { width: colM - 10, align: 'right' })
  y += 24
  for (const l of m.lines) {
    const desc = l.description ? safe(l.description) : ''
    const hName = doc.font('B').fontSize(9.5).heightOfString(safe(l.name), { width: colD - 20 })
    const hDesc = desc ? doc.font('R').fontSize(8).heightOfString(desc, { width: colD - 20 }) + 3 : 0
    const rowH = Math.max(30, hName + hDesc + 18)
    if (y + rowH > doc.page.height - 200) { doc.addPage(); y = 60 }
    T('B', 9.5, INK).text(safe(l.name), ML + 10, y + 9, { width: colD - 20 })
    if (desc) T('R', 8, GREY).text(desc, ML + 10, y + 9 + hName + 3, { width: colD - 20 })
    T('R', 9.5, INK)
    doc.text(qty(l.quantity), ML + colD, y + 9, { width: colQ, align: 'right' })
    doc.text(eur(l.netPrice), ML + colD + colQ, y + 9, { width: colPU, align: 'right' })
    T('B', 9.5, INK).text(eur(l.netAmount), ML + colD + colQ + colPU, y + 9, { width: colM - 10, align: 'right' })
    y += rowH
    doc.moveTo(ML, y).lineTo(ML + CW, y).lineWidth(0.6).strokeColor(LINE).stroke()
  }

  // ── Totaux ──
  y += 14
  const tw = 270, tx = ML + CW - tw
  const row = (label: string, value: string, bold = false, color = INK) => {
    T(bold ? 'B' : 'R', bold ? 10.5 : 9, color).text(label, tx, y, { width: tw - 80, lineBreak: false })
    T(bold ? 'B' : 'R', bold ? 10.5 : 9, color).text(value, tx, y, { width: tw - 8, align: 'right' })
    y += bold ? 20 : 15
  }
  const t = m.totals
  row('Total HT', eur(t.lineTotal))
  row('TVA non applicable (art. 293 B CGI)', '0,00 €', false, GREY)
  doc.rect(tx - 8, y - 2, tw + 8, 26).fill(INK)
  T('B', 11, '#ffffff').text(isAvoir ? 'Total de l’avoir' : 'Total', tx, y + 6, { width: tw - 100 })
  T('B', 11, '#ffffff').text(eur(t.grandTotal), tx, y + 6, { width: tw - 8, align: 'right' })
  y += 34
  if (built.paid) {
    row(`Payé le ${fmtDateFr(f.date_paiement)}`, `- ${eur(t.prepaid)}`, false, GREY)
    row('Reste à payer', eur(t.due), true, '#2f6a46')
  }

  // ── Règlement ──
  y += 8
  if (y > doc.page.height - 190) { doc.addPage(); y = 60 }
  const regl = REGLEMENTS[f.reglement || ''] || f.reglement || ''
  const reglTxt = built.paid
    ? `Facture acquittée le ${fmtDateFr(f.date_paiement)}${regl ? ` par ${regl}` : ''}. Aucune action n’est requise de votre part.`
    : isAvoir
      ? `Avoir émis sur la facture ${f.avoir_de_numero || ''}${f.avoir_de_date ? ` du ${fmtDateFr(f.avoir_de_date)}` : ''}.`
      : 'Paiement à réception de la facture.'
  doc.roundedRect(ML, y, CW, 46, 8).lineWidth(1).strokeColor(LINE).stroke()
  T('B', 7.5, ACCENT).text('CONDITIONS DE RÈGLEMENT', ML + 12, y + 10)
  T('R', 8.5, '#333333').text(safe(reglTxt), ML + 12, y + 23, { width: CW - 24 })
  y += 62

  // ── Mentions légales ──
  T('R', 7, GREY).text(built.mentions.map(safe).join('\n'), ML, y, { width: CW, lineGap: 1.5 })
  // Pied de page sous la marge basse : on lève la marge le temps d'écrire, sinon pdfkit ouvre une page vide.
  const mb = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  T('R', 7, '#999999').text(`Facture électronique au format Factur-X (profil EN 16931) — ${safe(ent.nomLegal)}, ${ent.forme}.`, ML, doc.page.height - 34, { width: CW, align: 'center', lineBreak: false })
  doc.page.margins.bottom = mb

  // ── Factur-X : XMP + XML joint (relation « Alternative ») ──
  doc.appendXML(FACTURX_XMP)
  ;(doc as unknown as { file: (b: Buffer, o: Record<string, unknown>) => void }).file(Buffer.from(xml, 'utf-8'), {
    name: FACTURX_XML_FILENAME, type: 'text/xml', relationship: 'Alternative',
    description: 'Facture électronique Factur-X (profil EN 16931)', creationDate: now, modifiedDate: now,
  })
  doc.end()
  await done
  const size = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(size)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
