// Modèle EN 16931 d'une facture Potentieel (adapté du modèle TonPilote).
// Les deux entités émettrices sont des entrepreneurs individuels en franchise de TVA
// (art. 293 B) : toutes les lignes sont en catégorie « E » à 0 %, motif VATEX-FR-FRANCHISE.
// Les factures automatiques sont émises APRÈS paiement : montant acquitté = total,
// reste dû = 0, cadre de facturation « S2 » (prestation de services déjà payée).
import { formatSiren, parseAddress, sirenOf, type PostalAddress } from './identifiers.ts'

export type VatCategory = 'S' | 'E' | 'AE'

export interface EParty {
  name: string
  tradingName?: string
  siren?: string
  vatId?: string
  taxRegistrationId?: string
  address: PostalAddress
  electronicAddress?: string
  email?: string
  phone?: string
}

export interface ELine {
  id: string
  name: string
  description?: string
  quantity: number
  unitCode: string
  grossPrice?: number
  discount?: number
  netPrice: number
  netAmount: number
  vatCategory: VatCategory
  vatRate: number
}

export interface EVatGroup {
  category: VatCategory
  rate: number
  base: number
  amount: number
  exemptionReason?: string
  exemptionCode?: string
  dueDateTypeCode?: string
}

export interface ENote { content: string; subject?: 'PMD' | 'PMT' | 'AAB' }

export interface EInvoice {
  number: string
  typeCode: '380' | '381' | '386'
  issueDate: string
  dueDate?: string
  businessProcess: string
  currency: 'EUR'
  buyerReference?: string
  sellerOrderReference?: string
  notes: ENote[]
  seller: EParty
  buyer: EParty
  delivery?: { name?: string; address: PostalAddress }
  paymentMeans?: { typeCode: '30' | '58'; iban?: string; bic?: string }
  paymentReference?: string
  paymentTerms?: string
  lines: ELine[]
  vat: EVatGroup[]
  totals: { lineTotal: number; taxBasis: number; tax: number; grandTotal: number; prepaid: number; due: number }
  precedingInvoice?: { number: string; date?: string }
}

// ─── Entités émettrices (données SIRENE publiques) ───
export interface Entite {
  prenom: string
  nomLegal: string
  forme: string
  siren: string
  siret: string
  rcs: string
  adresse: string
  email: string
  site: string
  lettre: string
}
export const ENTITES: Record<string, Entite> = {
  emrick: {
    prenom: 'Emrick', nomLegal: 'PERILLIAT EMRICK', forme: 'Entrepreneur individuel',
    siren: '990572117', siret: '99057211700010', rcs: 'RCS Chambéry',
    adresse: '4 avenue Maurice Franck, 73110 Valgelon-La Rochette',
    email: 'potentieel.web@gmail.com', site: 'potentieel.fr', lettre: 'E',
  },
  eloise: {
    prenom: 'Éloïse', nomLegal: 'CESAR-LE DREAU ELOISE', forme: 'Entrepreneur individuel',
    siren: '106848245', siret: '10684824500010', rcs: 'RCS Chambéry',
    adresse: '110 chemin des Bernades, Immeuble Les Etour, Montée B 2e étage, 73250 Saint-Pierre-d’Albigny',
    email: 'potentieel.web@gmail.com', site: 'potentieel.fr', lettre: 'L',
  },
}

export const FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI'
export const PMD_TEXT = 'Pénalités de retard : trois fois le taux d’intérêt légal, exigibles dès le lendemain de l’échéance.'
export const PMT_TEXT = 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € (art. D441-5 C. com.).'
export const AAB_TEXT = 'Pas d’escompte pour paiement anticipé.'

export const REGLEMENTS: Record<string, string> = {
  stripe: 'paiement en ligne (carte bancaire, Stripe)',
  virement: 'virement bancaire',
  especes: 'espèces',
  cheque: 'chèque',
}

// ─── Ligne de la table crm_factures ───
export interface FactureRow {
  id: string
  entite: string
  type: 'facture' | 'avoir'
  numero: string | null
  client: { nom?: string; email?: string; tel?: string; adresse?: string; siret?: string; siren?: string }
  lignes: { designation?: string; description?: string; quantite?: number | string; prix_unitaire?: number | string }[]
  total: number | string
  date_emission: string | null
  date_paiement: string | null
  reglement: string | null
  avoir_de_numero?: string | null
  avoir_de_date?: string | null
}

export const round2 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7) / 100
const round6 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 1e6 + 1e-4) / 1e6
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim()
export const fmtDateFr = (iso?: string | null) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export interface Built {
  model: EInvoice
  entite: Entite
  paid: boolean
  mentions: string[]
  warnings: string[]
}

export function buildEInvoice(f: FactureRow, numero: string, issueDate: string): Built {
  const ent = ENTITES[f.entite] || ENTITES.emrick
  const warnings: string[] = []
  const typeCode: EInvoice['typeCode'] = f.type === 'avoir' ? '381' : '380'
  const paid = !!f.date_paiement && f.type === 'facture'

  const seller: EParty = {
    name: ent.nomLegal,
    tradingName: 'Potentieel',
    siren: ent.siren,
    taxRegistrationId: ent.siren,
    address: parseAddress(ent.adresse),
    electronicAddress: ent.siren,
    email: ent.email,
  }

  const cl = f.client || {}
  const buyerSiren = sirenOf(cl.siret) || sirenOf(cl.siren)
  const buyerAddress = parseAddress(cl.adresse)
  if (!buyerAddress.postcode || !buyerAddress.city) warnings.push('Adresse du client incomplète (code postal / ville).')
  const buyer: EParty = {
    name: clean(cl.nom) || 'Client',
    siren: buyerSiren || undefined,
    address: buyerAddress,
    electronicAddress: buyerSiren || undefined,
  }

  const lines: ELine[] = (f.lignes || []).map((l, i) => {
    const q = num(l.quantite) || 1
    const pu = num(l.prix_unitaire)
    const amount = round2(q * pu)
    return {
      id: String(i + 1),
      name: clean(l.designation) || `Prestation ${i + 1}`,
      description: clean(l.description) || undefined,
      quantity: q,
      unitCode: 'C62',
      netPrice: round6(Math.abs(pu)),
      netAmount: amount,
      vatCategory: 'E',
      vatRate: 0,
    }
  })
  if (!lines.length) {
    const t = round2(num(f.total))
    lines.push({ id: '1', name: 'Prestation', quantity: 1, unitCode: 'C62', netPrice: Math.abs(t), netAmount: t, vatCategory: 'E', vatRate: 0 })
  }

  const lineTotal = round2(lines.reduce((s, l) => s + l.netAmount, 0))
  if (Math.abs(lineTotal - round2(num(f.total))) >= 0.01) warnings.push(`Total des lignes (${lineTotal}) différent du total enregistré (${f.total}).`)
  const vat: EVatGroup[] = [{
    category: 'E', rate: 0, base: lineTotal, amount: 0,
    exemptionReason: FRANCHISE_MENTION, exemptionCode: 'VATEX-FR-FRANCHISE',
  }]
  const prepaid = paid ? lineTotal : 0
  const due = round2(lineTotal - prepaid)

  const notes: ENote[] = [
    { content: `${FRANCHISE_MENTION}.` },
    ...(f.type === 'avoir' && f.avoir_de_numero
      ? [{ content: `Avoir sur la facture ${f.avoir_de_numero}${f.avoir_de_date ? ` du ${fmtDateFr(f.avoir_de_date)}` : ''}.` }]
      : []),
    { subject: 'PMD', content: PMD_TEXT },
    { subject: 'PMT', content: PMT_TEXT },
    { subject: 'AAB', content: AAB_TEXT },
  ]

  const regl = REGLEMENTS[f.reglement || ''] || f.reglement || ''
  const paymentTerms = paid
    ? `Facture acquittée le ${fmtDateFr(f.date_paiement)}${regl ? ` par ${regl}` : ''}.`
    : 'Paiement à réception de la facture.'

  const model: EInvoice = {
    number: numero,
    typeCode,
    issueDate,
    dueDate: issueDate,
    businessProcess: paid ? 'S2' : 'S1',
    currency: 'EUR',
    notes,
    seller,
    buyer,
    paymentReference: numero,
    paymentTerms,
    lines,
    vat,
    totals: { lineTotal, taxBasis: lineTotal, tax: 0, grandTotal: lineTotal, prepaid, due },
    precedingInvoice: f.type === 'avoir' && f.avoir_de_numero
      ? { number: f.avoir_de_numero, date: f.avoir_de_date || undefined }
      : undefined,
  }

  const mentions = [
    'Catégorie de l’opération : prestation de services.',
    `${FRANCHISE_MENTION}.`,
    `${PMD_TEXT} ${PMT_TEXT} ${AAB_TEXT}`,
  ]
  return { model, entite: ent, paid, mentions, warnings }
}

export const sirenLabel = (s?: string) => (s ? formatSiren(s) : '')
