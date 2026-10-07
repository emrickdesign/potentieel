import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * stripe-webhook — reçoit les paiements Stripe et met à jour les fiches clients
 * du CRM dans `crm_items` (section 'clients'), la table que lit l'interface.
 * (L'ancienne version écrivait dans la table legacy `crm_data`, abandonnée par
 * le front en juin : plus aucun paiement ne remontait.)
 *
 * Événements :
 *  - customer.subscription.created : paiement du site en N fois = abonnement
 *    temporaire (metadata.auto_cancel_after_months=N) → on pose cancel_at.
 *  - invoice.paid : versement N fois (coche le bon versement + facture) ou
 *    abonnement (MRR, mrrDepuis, statut actif + facture).
 *  - checkout.session.completed (mode payment) : paiement unique (site en 1×,
 *    honoraires Ads, mois sans engagement…) → facture (+ versement 1/1).
 *
 * Fiche retrouvée par metadata.crm_client_id (posé par stripe-checkout), sinon
 * par email. Idempotent : table crm_stripe_events + id de facture Stripe stocké
 * sur chaque facture. Le numéro de versement vient du rang de la facture dans
 * l'abonnement : si le versement a déjà été coché à la main, rien ne bouge.
 * Aucun secret en dur : clés Stripe et secrets de signature lus dans l'env ou le Vault.
 * Le même endpoint sert les DEUX comptes Stripe de l'agence : voir ACCOUNTS.
 */

type AnyObj = Record<string, any>;
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

const _sec: Record<string, string> = {};
async function secret(name: string): Promise<string> {
  const env = Deno.env.get(name.toUpperCase());
  if (env) return env;
  if (_sec[name]) return _sec[name];
  const { data, error } = await admin.rpc("crm_secret_get", { p_name: name });
  if (error || !data) throw new Error(`Secret ${name} introuvable`);
  return (_sec[name] = String(data));
}
/*
 * Les deux comptes Stripe de l'agence (cf. stripe-checkout). Un même endpoint
 * reçoit les deux : c'est le secret de signature qui valide l'événement qui dit
 * de quel compte il vient — et donc quelle clé utiliser pour rappeler Stripe,
 * et quelle entité a réellement encaissé.
 */
const ACCOUNTS: Record<string, { label: string; secret: string; whsec: string }> = {
  emrick: { label: "Emrick", secret: "crm_stripe_secret_key",        whsec: "crm_stripe_webhook_secret" },
  eloise: { label: "Éloïse", secret: "crm_stripe_secret_key_eloise", whsec: "crm_stripe_webhook_secret_eloise" },
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Anciens prix fixes (liens générés avant l'ajout de metadata.crm_kind).
const PRICE_SUB = new Set(["price_1TRM9BGTQMkzV0RdVEPRQomA", "price_1TT3vdGTQMkzV0Rdnp2ULx17"]);
const PRICE_ONE = new Set(["price_1TWEmnGTQMkzV0Rd0BTukXsh", "price_1TWEmmGTQMkzV0Rdc2rTCnMW"]);
const PRICE_SETUP_990 = "price_1TRMsbGTQMkzV0RdpmrZjopY";

// ── Signature Stripe (HMAC-SHA256, tolérance 5 min, plusieurs v1 possibles) ──
async function verifyStripeSignature(payload: string, sigHeader: string, whsec: string): Promise<boolean> {
  const parts = sigHeader.split(",").map((p) => p.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const v1s = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !v1s.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(whsec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1s.some((v) => safeEqual(v, expected));
}

// ── API Stripe ──
async function stripe(acct: string, method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<AnyObj> {
  const params = new URLSearchParams();
  if (body) {
    const flat = (o: unknown, p = "") => {
      if (o === null || o === undefined) return;
      if (typeof o === "object") for (const [k, v] of Object.entries(o as AnyObj)) flat(v, p ? `${p}[${k}]` : k);
      else params.append(p, String(o));
    };
    flat(body);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${await secret(ACCOUNTS[acct].secret)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body ? params.toString() : undefined,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${out?.error?.message ?? "erreur"}`);
  return out;
}

// ── Dates (Europe/Paris) ──
const frDate = (ms: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(ms));
const isoDate = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
const fmtEUR = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const r2 = (n: number) => Math.round(n * 100) / 100;

function toMonthly(unitAmount: number, qty: number, interval: string, count: number): number {
  const per = (unitAmount / 100) * (qty || 1);
  const n = count || 1;
  switch (interval) {
    case "year": return per / (12 * n);
    case "month": return per / n;
    case "week": return (per * 52) / (12 * n);
    case "day": return (per * 365) / (12 * n);
    default: return 0;
  }
}

// ── Fiches clients (crm_items, section 'clients') ──
async function loadClients(): Promise<AnyObj[]> {
  const { data, error } = await admin.from("crm_items").select("id,payload").eq("section", "clients");
  if (error) throw new Error("Lecture clients : " + error.message);
  return (data ?? []).map((r: AnyObj) => ({ ...(r.payload ?? {}), id: r.payload?.id ?? r.id }));
}
async function saveClient(c: AnyObj) {
  const { error } = await admin.from("crm_items").upsert(
    { section: "clients", id: String(c.id), payload: c, updated_at: new Date().toISOString() },
    { onConflict: "section,id" },
  );
  if (error) throw new Error("Écriture client : " + error.message);
}
function findClient(clients: AnyObj[], clientId?: string, email?: string): AnyObj | null {
  if (clientId) {
    const byId = clients.find((c) => String(c.id) === String(clientId));
    if (byId) return byId;
  }
  const e = (email ?? "").toLowerCase().trim();
  if (!e) return null;
  return clients.find((c) => String(c.email ?? "").toLowerCase().trim() === e) ?? null;
}
// Même format que le CRM : FA-MM-AAAA-NNN, NNN = nombre total de factures + 1.
function nextRef(clients: AnyObj[], ms: number): string {
  const count = clients.reduce((s, c) => s + (Array.isArray(c.factures) ? c.factures.length : 0), 0);
  const [y, m] = isoDate(ms).split("-");
  return `FA-${m}-${y}-${String(count + 1).padStart(3, "0")}`;
}
// `owner` = entité qui émet la facture. C'est celle dont le compte Stripe a
// encaissé, pas celle rattachée à la fiche : l'argent est arrivé chez elle.
function baseData(c: AnyObj, acct: string): AnyObj {
  return {
    entreprise: c.nom || "", email: c.email || "", tel: c.tel || "", adresse: c.adresse || "",
    idType: c.siret ? "SIRET" : c.siren ? "SIREN" : "", idNum: c.siret || c.siren || "",
    reglement: "stripe", owner: acct,
  };
}
function pushFacture(clients: AnyObj[], c: AnyObj, ms: number, f: AnyObj) {
  if (!Array.isArray(c.factures)) c.factures = [];
  c.factures.unshift({ ref: nextRef(clients, ms), date: frDate(ms), echeance: frDate(ms), statut: "payee", ...f });
}
function ensureVersements(c: AnyObj, n: number) {
  const cur = Array.isArray(c.siteVersements) ? c.siteVersements : [];
  c.siteVersements = Array.from({ length: n }, (_, i) => !!cur[i]);
}

// ── invoice.paid ──
async function handleInvoicePaid(event: AnyObj, acct: string): Promise<string> {
  const inv = event.data.object as AnyObj;
  if (inv.status !== "paid") return "ignoré (non payée)";
  const amount = (inv.amount_paid || 0) / 100;
  if (amount <= 0) return "ignoré (montant nul)";

  const subId: string | null = inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null;
  const sub = subId ? await stripe(acct, "GET", `subscriptions/${subId}`) : null;
  const md: AnyObj = { ...(sub?.metadata ?? {}), ...(inv.parent?.subscription_details?.metadata ?? {}) };

  let email = inv.customer_email || "";
  if (!email && inv.customer) email = (await stripe(acct, "GET", `customers/${inv.customer}`)).email || "";

  const clients = await loadClients();
  const c = findClient(clients, md.crm_client_id, email);
  if (!c) return `client introuvable (${md.crm_client_id || email || "sans email"})`;
  if ((c.factures ?? []).some((f: AnyObj) => f.stripeInvoiceId === inv.id)) return "déjà traité";

  const paidMs = (inv.status_transitions?.paid_at ?? event.created) * 1000;
  const months = Number(md.auto_cancel_after_months || 0);
  const data = baseData(c, acct);
  const fid = "fas_" + event.id;

  if (months >= 2 && subId) {
    // Paiement du site en N fois : rang de cette facture parmi les échéances payées.
    const list = await stripe(acct, "GET", `invoices?subscription=${subId}&status=paid&limit=100`);
    const paid = ((list.data ?? []) as AnyObj[]).filter((x) => (x.amount_paid || 0) > 0).sort((a, b) => a.created - b.created);
    const idx = paid.findIndex((x) => x.id === inv.id);
    const num = idx >= 0 ? idx + 1 : paid.length + 1;
    if (!c.sitePlan) c.sitePlan = `${months}x`;
    const n = parseInt(c.sitePlan) || months;
    ensureVersements(c, n);
    if (num <= n) c.siteVersements[num - 1] = true;
    if (!c.siteFirstPayDate && num === 1) c.siteFirstPayDate = isoDate(paidMs);
    pushFacture(clients, c, paidMs, {
      id: fid, stripeInvoiceId: inv.id, totalTxt: `${fmtEUR(amount)} (versement ${num}/${n})`, montantNum: amount,
      data: { ...data, versementMontant: amount, versementNote: `Versement ${num}/${n} — paiement du site (Stripe)` },
    });
    await saveClient(c);
    return `versement ${num}/${n} coché pour ${c.nom}`;
  }

  if (sub) {
    // Vrai abonnement de service : MRR recalculé depuis les items de l'abonnement.
    let monthly = 0;
    for (const it of (sub.items?.data ?? []) as AnyObj[]) {
      const rec = it.price?.recurring;
      if (rec?.interval) monthly += toMonthly(it.price.unit_amount ?? 0, it.quantity ?? 1, rec.interval, rec.interval_count ?? 1);
    }
    monthly = r2(monthly);
    const lines = (inv.lines?.data ?? []) as AnyObj[];
    const recLine = lines.find((l) => l.period && (l.period.end - l.period.start) > 20 * 86400) ?? lines[0];
    const pStart = recLine?.period?.start ? recLine.period.start * 1000 : paidMs;
    const pEnd = recLine?.period?.end ? recLine.period.end * 1000 : addMonthsClamped(new Date(paidMs), 1).getTime();

    if (monthly > 0) {
      c.mrr = monthly;
      if (!c.mrrDepuis) c.mrrDepuis = isoDate(pStart);
      if (c.statut !== "actif" && c.statut !== "retard") c.statut = "actif";
    }
    const aboKey = String(monthly);
    const periode = `Du ${frDate(pStart)} au ${frDate(pEnd)}`;
    const detail = (aboKey === "20" || aboKey === "49")
      ? { abo: aboKey, periode }
      : { versementMontant: amount, versementNote: `Abonnement mensuel — ${periode}` };
    pushFacture(clients, c, paidMs, {
      id: fid, stripeInvoiceId: inv.id, echeance: frDate(pEnd),
      totalTxt: monthly > 0 ? `${fmtEUR(amount)} — abonnement ${fmtEUR(monthly)}/mois` : fmtEUR(amount),
      montantNum: amount, data: { ...data, ...detail },
    });
    await saveClient(c);
    return `abonnement ${monthly} €/mois enregistré pour ${c.nom}`;
  }

  // Facture Stripe ponctuelle hors abonnement.
  pushFacture(clients, c, paidMs, {
    id: fid, stripeInvoiceId: inv.id, totalTxt: fmtEUR(amount), montantNum: amount,
    data: { ...data, versementMontant: amount, versementNote: "Paiement Stripe" },
  });
  await saveClient(c);
  return `facture ponctuelle pour ${c.nom}`;
}

// ── checkout.session.completed (paiements uniques) ──
async function handleCheckoutCompleted(event: AnyObj, acct: string): Promise<string> {
  const s = event.data.object as AnyObj;
  if (s.mode !== "payment") return "ignoré (abonnement → invoice.paid)";
  if (s.payment_status !== "paid") return "ignoré (non payé)";
  const amount = (s.amount_total || 0) / 100;
  if (amount <= 0) return "ignoré (montant nul)";

  let md: AnyObj = { ...(s.metadata ?? {}) };
  if (!md.crm_client_id && s.payment_link) {
    try { md = { ...((await stripe(acct, "GET", `payment_links/${s.payment_link}`)).metadata ?? {}), ...md }; } catch { /* lien supprimé */ }
  }
  const email = s.customer_details?.email || s.customer_email || "";

  const clients = await loadClients();
  const c = findClient(clients, md.crm_client_id, email);
  if (!c) return `client introuvable (${md.crm_client_id || email || "sans email"})`;
  if ((c.factures ?? []).some((f: AnyObj) => f.stripeSessionId === s.id)) return "déjà traité";

  let label = "Paiement Stripe";
  let priceId = "";
  try {
    const li = await stripe(acct, "GET", `checkout/sessions/${s.id}/line_items`);
    priceId = li.data?.[0]?.price?.id || "";
    label = li.data?.[0]?.description || label;
  } catch { /* libellé par défaut */ }

  const kind = md.crm_kind || (priceId === PRICE_SETUP_990 ? "site_1x" : PRICE_ONE.has(priceId) ? "abo_mois" : PRICE_SUB.has(priceId) ? "abo" : "unique");
  const paidMs = event.created * 1000;
  const data = baseData(c, acct);
  const base = { id: "fas_" + event.id, stripeSessionId: s.id, montantNum: amount, totalTxt: fmtEUR(amount) };

  if (kind === "site_1x") {
    if (!c.sitePlan) c.sitePlan = "1x";
    if ((parseInt(c.sitePlan) || 1) === 1) {
      ensureVersements(c, 1);
      c.siteVersements[0] = true;
      if (!c.siteFirstPayDate) c.siteFirstPayDate = isoDate(paidMs);
    }
    const detail = amount === 990 ? { creation: "1x" } : { versementMontant: amount, versementNote: "Paiement du site en une fois (Stripe)" };
    pushFacture(clients, c, paidMs, { ...base, data: { ...data, ...detail } });
  } else if (kind === "abo_mois") {
    const end = addMonthsClamped(new Date(paidMs), 1).getTime();
    const periode = `Du ${frDate(paidMs)} au ${frDate(end)}`;
    const key = String(amount);
    const detail = (key === "20" || key === "49") ? { abo: key, periode } : { versementMontant: amount, versementNote: `Abonnement — ${periode}` };
    pushFacture(clients, c, paidMs, { ...base, echeance: frDate(end), totalTxt: `${fmtEUR(amount)}/mois`, data: { ...data, ...detail } });
  } else {
    pushFacture(clients, c, paidMs, { ...base, data: { ...data, versementMontant: amount, versementNote: label } });
  }
  await saveClient(c);
  return `paiement unique (${kind}) enregistré pour ${c.nom}`;
}

// ── Point d'entrée ──
Deno.serve(async (req: Request) => {
  const raw = await req.text();
  const sigHeader = req.headers.get("stripe-signature") || "";

  // Quel compte a envoyé l'événement ? Celui dont le secret valide la signature.
  // Un compte sans secret configuré est simplement ignoré (il n'envoie rien).
  let acct = "";
  let configured = 0;
  for (const [name, a] of Object.entries(ACCOUNTS)) {
    let whsec = "";
    try { whsec = await secret(a.whsec); } catch { continue; }
    configured++;
    if (await verifyStripeSignature(raw, sigHeader, whsec)) { acct = name; break; }
  }
  if (!configured) { console.log("stripe-webhook: aucun secret de signature configuré"); return new Response("config", { status: 500 }); }
  if (!acct) return new Response("Invalid signature", { status: 400 });

  let event: AnyObj;
  try { event = JSON.parse(raw); } catch { return new Response("Bad payload", { status: 400 }); }

  const { data: seen } = await admin.from("crm_stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return new Response("ok (déjà traité)", { status: 200 });

  try {
    let result = "ignoré";
    if (event.type === "customer.subscription.created") {
      const sub = event.data.object as AnyObj;
      const months = Number(sub.metadata?.auto_cancel_after_months || 0);
      if (months >= 2 && months <= 12 && !sub.cancel_at) {
        const cancelAt = Math.floor(addMonthsClamped(new Date(sub.start_date * 1000), months).getTime() / 1000);
        await stripe(acct, "POST", `subscriptions/${sub.id}`, { cancel_at: cancelAt });
        result = `cancel_at posé (${months} mois)`;
      }
    } else if (event.type === "invoice.paid") {
      result = await handleInvoicePaid(event, acct);
    } else if (event.type === "checkout.session.completed") {
      result = await handleCheckoutCompleted(event, acct);
    }
    await admin.from("crm_stripe_events").insert({ id: event.id, type: event.type, result: `[${acct}] ${result}` });
    console.log("stripe-webhook:", acct, event.type, event.id, "→", result);
    return new Response("ok", { status: 200 });
  } catch (e) {
    // Erreur réelle (Stripe/DB) → 500 : Stripe réessaiera, le traitement est idempotent.
    console.log("stripe-webhook: erreur", event.type, event.id, e instanceof Error ? e.message : String(e));
    return new Response("error", { status: 500 });
  }
});
