import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * stripe-checkout — génère un lien de paiement Stripe depuis la fiche client.
 * Réservée à l'équipe (table potentieel_equipe). Aucun secret en dur : les clés
 * Stripe sont lues dans l'env ou le Vault (voir ACCOUNTS).
 *
 * DEUX COMPTES STRIPE, un par entité de l'agence (cf. COMPANY_INFO du CRM) :
 * le CRM envoie `account` ('emrick' par défaut, 'eloise'), et c'est l'entité de
 * ce compte qui encaisse donc qui facture. Les prix fixes (price_…) n'existent
 * que sur le compte d'Emrick : sur tout autre compte, le prix équivalent est
 * créé au premier usage puis retrouvé par son `lookup_key` (le catalogue Stripe
 * du compte sert de cache, rien à stocker côté base).
 *
 * Chaque lien/session porte metadata.crm_client_id (+ crm_kind, crm_account) :
 * le webhook retrouve ainsi la fiche sans dépendre de l'email saisi par le client.
 * Paiement du site en N fois = abonnement temporaire avec
 * metadata.auto_cancel_after_months=N (le webhook pose cancel_at).
 */

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

async function requireTeam(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  const email = (user?.email ?? "").toLowerCase();
  if (!email) return null;
  const { data } = await admin.from("potentieel_equipe").select("email").eq("email", email).maybeSingle();
  return data ? email : null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Prix fixes du compte d'Emrick (créés à la main dans son tableau de bord Stripe).
const PRICES: Record<string, string> = {
  sub_49:    "price_1TRM9BGTQMkzV0RdVEPRQomA",
  sub_20:    "price_1TT3vdGTQMkzV0Rdnp2ULx17",
  one_49:    "price_1TWEmnGTQMkzV0Rd0BTukXsh",
  one_20:    "price_1TWEmmGTQMkzV0Rdc2rTCnMW",
  setup_990: "price_1TRMsbGTQMkzV0RdpmrZjopY",
};

// Les mêmes offres, décrites en montants : de quoi recréer le prix à l'identique
// sur un compte qui ne l'a pas encore.
const CATALOGUE: Record<string, { cents: number; label: string; recurring: boolean }> = {
  sub_49:    { cents: 4900,  label: "Abonnement Potentieel — 49 €/mois",       recurring: true },
  sub_20:    { cents: 2000,  label: "Abonnement Potentieel Light — 20 €/mois", recurring: true },
  one_49:    { cents: 4900,  label: "Gestion 1 mois — 49 €",                   recurring: false },
  one_20:    { cents: 2000,  label: "Gestion 1 mois — 20 €",                   recurring: false },
  setup_990: { cents: 99000, label: "Création site Potentieel — 990 €",        recurring: false },
};

const ACCOUNTS: Record<string, { label: string; secret: string; prices: Record<string, string> }> = {
  emrick: { label: "Emrick", secret: "crm_stripe_secret_key",        prices: PRICES },
  eloise: { label: "Éloïse", secret: "crm_stripe_secret_key_eloise", prices: {} },
};

function flattenForm(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  function flatten(obj: unknown, prefix = "") {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`));
    else if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}[${k}]` : k);
    } else params.append(prefix, String(obj));
  }
  flatten(body);
  return params;
}

async function stripePost(acct: string, path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await secret(ACCOUNTS[acct].secret)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: flattenForm(body).toString(),
  });
  return res.json();
}

async function stripeGet(acct: string, path: string): Promise<Record<string, any>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${await secret(ACCOUNTS[acct].secret)}` },
  });
  return res.json();
}

const createPrice = async (acct: string, cents: number, label: string) =>
  (await stripePost(acct, "prices", { unit_amount: cents, currency: "eur", product_data: { name: label } })).id as string;
const createRecurringPrice = async (acct: string, cents: number, label: string) =>
  (await stripePost(acct, "prices", { unit_amount: cents, currency: "eur", recurring: { interval: "month" }, product_data: { name: label } })).id as string;

// Prix d'une offre du catalogue sur un compte donné : l'id fixe s'il existe,
// sinon celui déjà créé sur ce compte (retrouvé par lookup_key), sinon on le crée.
async function priceFor(acct: string, key: string): Promise<string> {
  const fixed = ACCOUNTS[acct].prices[key];
  if (fixed) return fixed;
  const spec = CATALOGUE[key];
  if (!spec) throw new Error(`Offre inconnue : ${key}`);
  const lookup = `potentieel_${key}`;
  const found = await stripeGet(acct, `prices?lookup_keys[]=${encodeURIComponent(lookup)}&active=true&limit=1`);
  const hit = (found.data ?? [])[0]?.id;
  if (hit) return hit as string;
  const created = await stripePost(acct, "prices", {
    unit_amount: spec.cents, currency: "eur", lookup_key: lookup,
    ...(spec.recurring ? { recurring: { interval: "month" } } : {}),
    product_data: { name: spec.label },
  });
  if (created.error) throw new Error(created.error.message);
  return created.id as string;
}

function withPrefilledEmail(url: string, email?: string): string {
  if (!email) return url;
  return `${url}${url.includes("?") ? "&" : "?"}prefilled_email=${encodeURIComponent(email)}`;
}

// Prochaine occurrence du jour « day » (1-28), au moins ~48 h dans le futur
// (contrainte Stripe : trial_end suffisamment loin).
function nextAnchorTimestamp(day: number): number {
  const safeDay = Math.min(Math.max(Math.round(day) || 1, 1), 28);
  const minTs = Date.now() + 48 * 3600 * 1000;
  const now = new Date();
  let m = now.getUTCMonth();
  let anchor = new Date(Date.UTC(now.getUTCFullYear(), m, safeDay, 9, 0, 0));
  while (anchor.getTime() < minTs) { m += 1; anchor = new Date(Date.UTC(now.getUTCFullYear(), m, safeDay, 9, 0, 0)); }
  return Math.floor(anchor.getTime() / 1000);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (!(await requireTeam(req))) return json({ error: "Unauthorized" }, 401);

    const { type, nbPaiements, customAmount, firstExtra, anchorDay, clientEmail, clientId, account } = await req.json();
    const acct = ACCOUNTS[account] ? String(account) : "emrick";
    // Clé absente = compte pas encore branché : on le dit en clair plutôt que
    // de laisser remonter un « Secret … introuvable ».
    try { await secret(ACCOUNTS[acct].secret); } catch {
      return json({ error: `Le compte Stripe de ${ACCOUNTS[acct].label} n'est pas encore connecté (secret ${ACCOUNTS[acct].secret} absent côté Supabase).` }, 400);
    }

    const origin = req.headers.get("origin") || "https://potentieel.vercel.app";
    const success = `${origin}/admin.html?stripe=success`;
    const cancel = `${origin}/admin.html?stripe=cancel`;

    // Identification de la fiche client, propagée partout où Stripe la conserve.
    const meta = (kind: string, extra: Record<string, string> = {}) => ({
      ...(clientId ? { crm_client_id: String(clientId) } : {}), crm_kind: kind, crm_account: acct, ...extra,
    });
    const link = async (lineItems: unknown[], kind: string, subMeta?: Record<string, string>) => {
      const p: Record<string, unknown> = {
        restrictions: { completed_sessions: { limit: 1 } },
        after_completion: { type: "redirect", redirect: { url: success } },
        line_items: lineItems,
        metadata: meta(kind),
      };
      if (subMeta) p.subscription_data = { metadata: meta(kind, subMeta) };
      return stripePost(acct, "payment_links", p);
    };
    const session = async (lineItems: unknown[], kind: string, trialEnd: number) =>
      stripePost(acct, "checkout/sessions", {
        success_url: success, cancel_url: cancel, customer_email: clientEmail || undefined,
        mode: "subscription", line_items: lineItems, metadata: meta(kind),
        subscription_data: { trial_end: trialEnd, metadata: meta(kind) },
      });

    let result: Record<string, any>;
    let isPaymentLink = true;
    const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");

    switch (type) {
      case "combo_990_49":
        result = await link([{ price: await priceFor(acct, "sub_49"), quantity: 1 }, { price: await priceFor(acct, "setup_990"), quantity: 1 }], "abo", {});
        break;
      case "sub_49":
        result = await link([{ price: await priceFor(acct, "sub_49"), quantity: 1 }], "abo", {});
        break;
      case "sub_20":
        result = await link([{ price: await priceFor(acct, "sub_20"), quantity: 1 }], "abo", {});
        break;
      case "one_49":
        result = await link([{ price: await priceFor(acct, "one_49"), quantity: 1 }], "abo_mois");
        break;
      case "one_20":
        result = await link([{ price: await priceFor(acct, "one_20"), quantity: 1 }], "abo_mois");
        break;
      case "combo_20_sub": {
        isPaymentLink = false;
        const now = new Date();
        const trialEnd = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 7, 0, 0, 0) / 1000);
        result = await session([{ price: await priceFor(acct, "sub_20"), quantity: 1 }, { price: await priceFor(acct, "one_20"), quantity: 1 }], "abo", trialEnd);
        break;
      }
      case "sub_custom": {
        // Montant mensuel libre : 1er mois payé tout de suite (article ponctuel),
        // puis prélèvement chaque mois le jour choisi (trial_end).
        isPaymentLink = false;
        const cents = customAmount ? Math.round(Number(customAmount) * 100) : 0;
        if (!cents || cents < 100) return json({ error: "Montant mensuel invalide (minimum 1 €)." }, 400);
        const label = `Abonnement mensuel — ${eur(cents)}€/mois`;
        const rec = await createRecurringPrice(acct, cents, label);
        const one = await createPrice(acct, cents, `${label} — 1er mois`);
        result = await session([{ price: rec, quantity: 1 }, { price: one, quantity: 1 }], "abo", nextAnchorTimestamp(Number(anchorDay) || 1));
        break;
      }
      case "setup_nx": {
        const n = Math.min(Math.max(nbPaiements || 1, 1), 4);
        const totalCents = customAmount ? Math.round(Number(customAmount) * 100) : 99000;
        const extraCents = (firstExtra && Number(firstExtra) > 0) ? Math.round(Number(firstExtra) * 100) : 0;
        if (n === 1) {
          const oneCents = totalCents + extraCents;
          const priceId = (customAmount || extraCents)
            ? await createPrice(acct, oneCents, `Création site Potentieel — ${eur(oneCents)}€`)
            : await priceFor(acct, "setup_990");
          result = await link([{ price: priceId, quantity: 1 }], "site_1x");
        } else {
          const cents = Math.round(totalCents / n);
          const priceId = await createRecurringPrice(acct, cents, `Création site Potentieel — ${eur(cents)}€/mois (${n}×)`);
          const items: Record<string, unknown>[] = [{ price: priceId, quantity: 1 }];
          if (extraCents > 0) items.push({ price: await createPrice(acct, extraCents, `Supplément 1er versement — ${eur(extraCents)}€`), quantity: 1 });
          result = await link(items, "site_nx", { auto_cancel_after_months: String(n) });
        }
        break;
      }
      case "ads_custom": {
        const cents = customAmount ? Math.round(Number(customAmount) * 100) : 15000;
        result = await link([{ price: await createPrice(acct, cents, `Honoraires Google Ads — ${(cents / 100).toFixed(0)}€`), quantity: 1 }], "ads");
        break;
      }
      default:
        return json({ error: "Unknown type" }, 400);
    }

    if (result.error) return json({ error: result.error.message }, 400);
    const url = isPaymentLink ? withPrefilledEmail(result.url as string, clientEmail) : (result.url as string);
    return json({ url, id: result.id, account: acct });
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
