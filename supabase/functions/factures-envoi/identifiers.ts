// Identifiants et adresses de la facture électronique (réforme 2026-2027) :
// SIREN/SIRET (clé de Luhn), n° de TVA intracommunautaire, IBAN/BIC, adresse structurée.
// Sans dépendance serveur : utilisable aussi côté navigateur (formulaires, contrôles).

export const digitsOnly = (s?: string | null) => (s || '').replace(/\D/g, '')

function luhn(num: string): boolean {
  let sum = 0
  for (let i = 0; i < num.length; i++) {
    let d = num.charCodeAt(num.length - 1 - i) - 48
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

/** SIREN (9 chiffres) tiré d'un SIRET ou d'un SIREN saisi, s'il est valide. */
export function sirenOf(value?: string | null): string | null {
  const d = digitsOnly(value)
  if (d.length !== 9 && d.length !== 14) return null
  const siren = d.slice(0, 9)
  return luhn(siren) ? siren : null
}

/** SIRET valide (14 chiffres, clé de Luhn — les établissements de La Poste font exception). */
export function siretOf(value?: string | null): string | null {
  const d = digitsOnly(value)
  if (d.length !== 14) return null
  return luhn(d) || d.startsWith('356000000') ? d : null
}

/** « 123456789 » → « 123 456 789 » */
export const formatSiren = (siren: string) => siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')

export function normalizeVatNumber(value?: string | null): string | null {
  const v = (value || '').replace(/[\s.-]/g, '').toUpperCase()
  return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(v) ? v : null
}

/** N° de TVA intracommunautaire français déduit du SIREN (clé = (12 + 3 × (SIREN mod 97)) mod 97). */
export function frenchVatNumber(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97
  return `FR${String(key).padStart(2, '0')}${siren}`
}

/** IBAN normalisé si le contrôle modulo 97 (ISO 13616) est bon. */
export function normalizeIban(value?: string | null): string | null {
  const v = (value || '').replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return null
  let rem = 0
  for (const ch of v.slice(4) + v.slice(0, 4)) {
    const code = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const c of code) rem = (rem * 10 + Number(c)) % 97
  }
  return rem === 1 ? v : null
}

export function normalizeBic(value?: string | null): string | null {
  const v = (value || '').replace(/\s/g, '').toUpperCase()
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) ? v : null
}

export interface PostalAddress {
  line1?: string
  line2?: string
  postcode?: string
  city?: string
  /** Code pays ISO 3166-1 alpha-2 */
  country: string
}

const COUNTRIES: Record<string, string> = {
  france: 'FR', belgique: 'BE', suisse: 'CH', luxembourg: 'LU', monaco: 'MC', allemagne: 'DE',
  espagne: 'ES', italie: 'IT', 'pays-bas': 'NL', portugal: 'PT', 'royaume-uni': 'GB',
}

/**
 * Découpe une adresse saisie en texte libre (« 12 rue X, 75001 Paris », sur une ou
 * plusieurs lignes) en champs structurés. Le code postal sert de pivot : ce qui précède
 * est la voie, ce qui suit est la ville.
 */
export function parseAddress(text?: string | null): PostalAddress {
  const parts = (text || '').split(/[\n\r,]+/).map(s => s.trim()).filter(Boolean)
  let country = 'FR'
  const last = parts[parts.length - 1]?.toLowerCase()
  if (last && COUNTRIES[last]) { country = COUNTRIES[last]; parts.pop() }

  for (let i = parts.length - 1; i >= 0; i--) {
    const m = /(?:^|\s)(\d{4,5})(?:\s+(.+))?$/.exec(parts[i])
    if (!m || (country === 'FR' && m[1].length !== 5)) continue
    let city = m[2]?.trim()
    let before = parts[i].slice(0, m.index).trim()
    if (!city && parts[i + 1]) city = parts[i + 1] // « 75001 » puis « Paris » à la ligne
    if (!city && before && !/\d/.test(before)) { city = before; before = '' } // « Paris 75001 »
    const street = [...parts.slice(0, i), ...(before ? [before] : [])]
    return { line1: street[0], line2: street.slice(1).join(', ') || undefined, postcode: m[1], city, country }
  }
  return { line1: parts[0], line2: parts.slice(1).join(', ') || undefined, country }
}

export const isAddressComplete = (a: PostalAddress) => !!(a.postcode && a.city)
