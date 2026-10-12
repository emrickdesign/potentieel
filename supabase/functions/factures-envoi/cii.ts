import type { EInvoice, ELine, EParty, EVatGroup } from './model.ts'
import type { PostalAddress } from './identifiers.ts'

// Sérialisation CII (UN/CEFACT CrossIndustryInvoice D16B) du profil Factur-X EN 16931,
// le profil de référence de la réforme française. L'ORDRE des éléments suit le schéma XSD :
// ne pas le modifier sans vérifier contre les XSD Factur-X.

export const FACTURX_GUIDELINE = 'urn:cen.eu:en16931:2017'

const NAMESPACES = [
  'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"',
  'xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"',
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"',
].join(' ')

/** Retire les caractères interdits en XML 1.0 puis échappe. */
function esc(value: string): string {
  let out = ''
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0
    const allowed = c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c < 0xd800) || (c > 0xdfff && c < 0xfffe) || c > 0xffff
    if (allowed) out += ch
  }
  return out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function decimal(n: number, maxDecimals: number, minDecimals = 0): string {
  const v = Math.abs(n) < 0.5 / 10 ** maxDecimals ? 0 : n
  let s = v.toFixed(maxDecimals)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  const [int, frac = ''] = s.split('.')
  return frac.length < minDecimals ? `${int}.${frac.padEnd(minDecimals, '0')}` : s
}
const amount = (n: number) => decimal(n, 2, 2)
const price = (n: number) => decimal(n, 6, 2)
const quantity = (n: number) => decimal(n, 4)
const percent = (n: number) => decimal(n, 2, 2)
const d102 = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

function tag(name: string, value: string | undefined | null, attrs?: Record<string, string>): string {
  if (value === undefined || value === null || value === '') return ''
  const a = attrs ? Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : ''
  return `<${name}${a}>${esc(value)}</${name}>`
}
const wrap = (name: string, inner: string) => (inner ? `<${name}>${inner}</${name}>` : '')
const dateTime = (name: string, iso: string | undefined, type: 'udt' | 'qdt' = 'udt') =>
  iso ? `<${name}><${type}:DateTimeString format="102">${d102(iso)}</${type}:DateTimeString></${name}>` : ''

function address(a: PostalAddress): string {
  return `<ram:PostalTradeAddress>${tag('ram:PostcodeCode', a.postcode)}${tag('ram:LineOne', a.line1)}${tag('ram:LineTwo', a.line2)}${tag('ram:CityName', a.city)}${tag('ram:CountryID', a.country || 'FR')}</ram:PostalTradeAddress>`
}

function party(name: string, p: EParty, withContact: boolean): string {
  const legal = wrap('ram:SpecifiedLegalOrganization', tag('ram:ID', p.siren, { schemeID: '0002' }) + tag('ram:TradingBusinessName', p.tradingName))
  const contact = withContact
    ? wrap('ram:DefinedTradeContact',
      wrap('ram:TelephoneUniversalCommunication', tag('ram:CompleteNumber', p.phone)) +
      wrap('ram:EmailURIUniversalCommunication', tag('ram:URIID', p.email)))
    : ''
  const uri = wrap('ram:URIUniversalCommunication', tag('ram:URIID', p.electronicAddress, { schemeID: '0225' }))
  const taxes =
    wrap('ram:SpecifiedTaxRegistration', tag('ram:ID', p.vatId, { schemeID: 'VA' })) +
    wrap('ram:SpecifiedTaxRegistration', tag('ram:ID', p.taxRegistrationId, { schemeID: 'FC' }))
  return wrap(name, tag('ram:Name', p.name) + legal + contact + address(p.address) + uri + taxes)
}

function line(l: ELine): string {
  const gross = l.grossPrice !== undefined
    ? `<ram:GrossPriceProductTradePrice>${tag('ram:ChargeAmount', price(l.grossPrice))}${l.discount
      ? `<ram:AppliedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>${tag('ram:ActualAmount', price(l.discount))}</ram:AppliedTradeAllowanceCharge>`
      : ''}</ram:GrossPriceProductTradePrice>`
    : ''
  return '<ram:IncludedSupplyChainTradeLineItem>' +
    wrap('ram:AssociatedDocumentLineDocument', tag('ram:LineID', l.id)) +
    wrap('ram:SpecifiedTradeProduct', tag('ram:Name', l.name) + tag('ram:Description', l.description)) +
    wrap('ram:SpecifiedLineTradeAgreement', gross + wrap('ram:NetPriceProductTradePrice', tag('ram:ChargeAmount', price(l.netPrice)))) +
    wrap('ram:SpecifiedLineTradeDelivery', tag('ram:BilledQuantity', quantity(l.quantity), { unitCode: l.unitCode })) +
    wrap('ram:SpecifiedLineTradeSettlement',
      wrap('ram:ApplicableTradeTax', tag('ram:TypeCode', 'VAT') + tag('ram:CategoryCode', l.vatCategory) + tag('ram:RateApplicablePercent', percent(l.vatRate))) +
      wrap('ram:SpecifiedTradeSettlementLineMonetarySummation', tag('ram:LineTotalAmount', amount(l.netAmount)))) +
    '</ram:IncludedSupplyChainTradeLineItem>'
}

function vatGroup(g: EVatGroup): string {
  return wrap('ram:ApplicableTradeTax',
    tag('ram:CalculatedAmount', amount(g.amount)) +
    tag('ram:TypeCode', 'VAT') +
    tag('ram:ExemptionReason', g.exemptionReason) +
    tag('ram:BasisAmount', amount(g.base)) +
    tag('ram:CategoryCode', g.category) +
    tag('ram:ExemptionReasonCode', g.exemptionCode) +
    tag('ram:DueDateTypeCode', g.dueDateTypeCode) +
    tag('ram:RateApplicablePercent', percent(g.rate)))
}

export function toCII(inv: EInvoice): string {
  const t = inv.totals
  const notes = inv.notes.map(n => wrap('ram:IncludedNote', tag('ram:Content', n.content) + tag('ram:SubjectCode', n.subject))).join('')

  const agreement = wrap('ram:ApplicableHeaderTradeAgreement',
    tag('ram:BuyerReference', inv.buyerReference) +
    party('ram:SellerTradeParty', inv.seller, true) +
    party('ram:BuyerTradeParty', inv.buyer, false) +
    wrap('ram:SellerOrderReferencedDocument', tag('ram:IssuerAssignedID', inv.sellerOrderReference)))

  const delivery = '<ram:ApplicableHeaderTradeDelivery>' +
    (inv.delivery ? wrap('ram:ShipToTradeParty', tag('ram:Name', inv.delivery.name) + address(inv.delivery.address)) : '') +
    '</ram:ApplicableHeaderTradeDelivery>'

  const means = inv.paymentMeans
    ? wrap('ram:SpecifiedTradeSettlementPaymentMeans',
      tag('ram:TypeCode', inv.paymentMeans.typeCode) +
      wrap('ram:PayeePartyCreditorFinancialAccount', tag('ram:IBANID', inv.paymentMeans.iban)) +
      wrap('ram:PayeeSpecifiedCreditorFinancialInstitution', tag('ram:BICID', inv.paymentMeans.bic)))
    : ''

  const summation = wrap('ram:SpecifiedTradeSettlementHeaderMonetarySummation',
    tag('ram:LineTotalAmount', amount(t.lineTotal)) +
    tag('ram:TaxBasisTotalAmount', amount(t.taxBasis)) +
    tag('ram:TaxTotalAmount', amount(t.tax), { currencyID: inv.currency }) +
    tag('ram:GrandTotalAmount', amount(t.grandTotal)) +
    (t.prepaid ? tag('ram:TotalPrepaidAmount', amount(t.prepaid)) : '') +
    tag('ram:DuePayableAmount', amount(t.due)))

  const preceding = inv.precedingInvoice
    ? wrap('ram:InvoiceReferencedDocument', tag('ram:IssuerAssignedID', inv.precedingInvoice.number) + dateTime('ram:FormattedIssueDateTime', inv.precedingInvoice.date, 'qdt'))
    : ''

  const settlement = wrap('ram:ApplicableHeaderTradeSettlement',
    tag('ram:PaymentReference', inv.paymentReference) +
    tag('ram:InvoiceCurrencyCode', inv.currency) +
    means +
    inv.vat.map(vatGroup).join('') +
    wrap('ram:SpecifiedTradePaymentTerms', tag('ram:Description', inv.paymentTerms) + dateTime('ram:DueDateDateTime', inv.dueDate)) +
    summation +
    preceding)

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rsm:CrossIndustryInvoice ${NAMESPACES}>` +
    '<rsm:ExchangedDocumentContext>' +
    wrap('ram:BusinessProcessSpecifiedDocumentContextParameter', tag('ram:ID', inv.businessProcess)) +
    wrap('ram:GuidelineSpecifiedDocumentContextParameter', tag('ram:ID', FACTURX_GUIDELINE)) +
    '</rsm:ExchangedDocumentContext>' +
    '<rsm:ExchangedDocument>' + tag('ram:ID', inv.number) + tag('ram:TypeCode', inv.typeCode) + dateTime('ram:IssueDateTime', inv.issueDate) + notes + '</rsm:ExchangedDocument>' +
    '<rsm:SupplyChainTradeTransaction>' + inv.lines.map(line).join('') + agreement + delivery + settlement + '</rsm:SupplyChainTradeTransaction>' +
    '</rsm:CrossIndustryInvoice>\n'
}
