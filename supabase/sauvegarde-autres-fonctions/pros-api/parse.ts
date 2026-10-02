// Lecture d'un lead Meta (field_data) → ligne de la table meta_leads.
// Fonctions pures : testées localement, sans dépendance.

export type Tranche = "lt100k" | "100k_300k" | "300k_1m" | "gt1m" | "inconnu";

type FieldData = { name?: string; values?: unknown[] };

// Questions standard des formulaires instantanés Meta → libellé affiché
const STANDARD: Record<string, string> = {
  full_name: "Nom",
  first_name: "Prénom",
  last_name: "Nom",
  email: "Email",
  work_email: "Email pro",
  phone_number: "Téléphone",
  work_phone_number: "Téléphone pro",
  company_name: "Entreprise",
  job_title: "Poste",
  city: "Ville",
  post_code: "Code postal",
  zip_code: "Code postal",
  street_address: "Adresse",
  state: "Région",
  province: "Région",
  country: "Pays",
};
// Champs d'identité : clés standard de Meta, sinon intitulé de la question personnalisée
// (un formulaire en français envoie « nom_complet », « numéro_de_téléphone »…)
const CLES_STANDARD: Record<string, string[]> = {
  nom: ["full_name"], prenom: ["first_name"], nomFamille: ["last_name"],
  telephone: ["phone_number", "work_phone_number"], email: ["email", "work_email"], entreprise: ["company_name"],
};
const cle = (name: string) => norm(name).replace(/_/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const SENS: Record<string, (k: string) => boolean> = {
  entreprise: (k) => /\b(entreprise|societe|company|raison sociale|nom commercial)\b/.test(k),
  email: (k) => /\b(e ?mail|courriel)\b/.test(k),
  telephone: (k) => /\b(telephone|tel|phone|portable|mobile|whatsapp)\b/.test(k),
  nom: (k) => /^(votre |ton )?(nom complet|nom et prenom|prenom et nom|prenom nom|full name|name)$/.test(k),
  prenom: (k) => /^(votre |ton )?(prenom|first name)$/.test(k),
  nomFamille: (k) => /^(votre |ton )?(nom|nom de famille|last name)$/.test(k),
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// "quel_est_votre_chiffre_d'affaires_?" → "Quel est votre chiffre d'affaires ?"
export function pretty(s: string): string {
  const t = String(s ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

// Montants contenus dans un texte, en euros : "300 000 à 1 million" → [300000, 1000000]
export function amounts(text: string): number[] {
  let t = norm(String(text ?? ""))
    .replace(/_/g, " ")
    .replace(/\s/g, " ")
    .replace(/€|euros?|\beur\b/g, " ")
    // Montants écrits en lettres : "plus d'un million", "moins de cent mille"
    .replace(/(^|[^a-z0-9])(?:d['’\s]?)?un\s+(million|milliard)/g, "$1 1 $2")
    .replace(/\b(deux|trois|quatre|cinq)\s+cents?\s+mille\b/g, (_m, w: string) =>
      ({ deux: "200000", trois: "300000", quatre: "400000", cinq: "500000" } as Record<string, string>)[w])
    .replace(/\bcent\s+mille\b/g, "100000");
  // Recolle les milliers : "100 000" / "100.000" / "1,000,000" → "100000"
  let prev: string;
  do {
    prev = t;
    t = t.replace(/(\d)[ .,](?=\d{3}(?:\D|$))/, "$1");
  } while (t !== prev);

  const found: { n: number; mult: number }[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(milliards?|mds?|millions?|m(?![a-z])|k(?![a-z]))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const u = m[2] || "";
    const mult = u.startsWith("milliard") || u.startsWith("md") ? 1e9
      : u.startsWith("million") || u === "m" ? 1e6
      : u === "k" ? 1e3
      : 1;
    found.push({ n: parseFloat(m[1].replace(",", ".")), mult });
  }
  // "entre 100 et 300 k" : l'unité du second nombre vaut pour le premier
  for (let i = 0; i < found.length - 1; i++) {
    if (found[i].mult === 1 && found[i].n < 1000 && found[i + 1].mult > 1) found[i].mult = found[i + 1].mult;
  }
  return found.map((f) => f.n * f.mult);
}

// Réponse à la question du CA → colonne du kanban
export function trancheCA(text: string): Tranche {
  if (!text) return "inconnu";
  const nums = amounts(text);
  if (!nums.length) return "inconnu";
  const bucket = (n: number): Tranche =>
    n < 100_000 ? "lt100k" : n < 300_000 ? "100k_300k" : n < 1_000_000 ? "300k_1m" : "gt1m";
  if (nums.length >= 2) return bucket(Math.min(...nums)); // fourchette : on classe sur la borne basse
  const t = norm(String(text)).replace(/_/g, " ");
  if (/moins|inferieur|jusqu|less|under|below|</.test(t)) return bucket(nums[0] - 1);
  return bucket(nums[0]);
}

const isQuestionCA = (name: string) =>
  /chiffre|affaire|\bca\b|revenu|turnover|revenue/.test(norm(name).replace(/_/g, " "));

// "2026-09-19T10:15:30+0000" (format Meta) → ISO
export function toIso(s: unknown): string {
  if (!s) return new Date().toISOString();
  const d = new Date(String(s).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// deno-lint-ignore no-explicit-any
export function mapLead(lead: any) {
  const fd: FieldData[] = Array.isArray(lead?.field_data) ? lead.field_data : [];
  const val = (f?: FieldData) =>
    (Array.isArray(f?.values) ? f!.values.map((v) => String(v)).join(", ") : "").trim();
  // Le champ qui joue un rôle : clé standard d'abord, puis intitulé de question personnalisée
  const champ = (role: string) =>
    fd.find((f) => CLES_STANDARD[role].includes(String(f?.name)) && val(f)) ||
    fd.find((f) => f?.name && !STANDARD[String(f.name)] && SENS[role](cle(String(f.name))) && val(f));
  const identite = {
    nom: champ("nom"), prenom: champ("prenom"), nomFamille: champ("nomFamille"),
    entreprise: champ("entreprise"), email: champ("email"), telephone: champ("telephone"),
  };
  // Filets : une réponse qui a la forme d'un numéro ou d'un email
  if (!identite.telephone) identite.telephone = fd.find((f) => /^\+?\d[\d\s.-]{8,}$/.test(val(f)));
  if (!identite.email) identite.email = fd.find((f) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(val(f)));
  const nom = val(identite.nom) || [val(identite.prenom), val(identite.nomFamille)].filter(Boolean).join(" ");
  // Déjà affichés en tête de fiche : inutile de les répéter dans les réponses
  const dejaAffiches = new Set([identite.nom, identite.prenom, identite.nomFamille, identite.email, identite.telephone].filter(Boolean));

  // Question du CA : d'abord par son intitulé, sinon par une réponse qui ressemble à un montant
  const caField = fd.find((f) => isQuestionCA(String(f?.name || ""))) ||
    fd.find((f) => {
      const name = String(f?.name || "");
      const v = norm(val(f));
      return !STANDARD[name] && /€|\d\s*k\b|million|moins de|plus de/.test(v) && trancheCA(val(f)) !== "inconnu";
    });

  const reponses = fd
    .filter((f) => f?.name && !dejaAffiches.has(f))
    .map((f) => {
      const name = String(f.name);
      return { q: STANDARD[name] || pretty(name), a: STANDARD[name] ? val(f) : pretty(val(f)) };
    })
    .filter((r) => r.a);

  return {
    meta_lead_id: String(lead.id),
    form_id: lead.form_id ? String(lead.form_id) : null,
    ad_id: lead.ad_id ? String(lead.ad_id) : null,
    ad_name: lead.ad_name || null,
    adset_name: lead.adset_name || null,
    campaign_name: lead.campaign_name || null,
    platform: lead.platform || null,
    is_organic: typeof lead.is_organic === "boolean" ? lead.is_organic : null,
    created_time: toIso(lead.created_time),
    nom: nom || null,
    telephone: val(identite.telephone) || null,
    email: val(identite.email) || null,
    entreprise: val(identite.entreprise) || null,
    ca_tranche: caField ? trancheCA(val(caField)) : ("inconnu" as Tranche),
    ca_reponse: caField ? pretty(val(caField)) || null : null,
    reponses,
    field_data: fd,
  };
}
