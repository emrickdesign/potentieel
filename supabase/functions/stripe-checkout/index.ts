import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * stripe-checkout — génère un lien de paiement Stripe depuis la fiche client.
 * Réservée à l'équipe (table potentieel_equipe). Aucun secret en dur : la clé
 * Stripe est lue dans l'env (CRM_STRIPE_SECRET_KEY) ou le Vault (crm_stripe_secret_key).
 *
 * Chaque lien/session porte metadata.crm_client_id (+ crm_kind) : le webhook
 * retrouve ainsi la fiche sans dépendre de l'email saisi par le client.
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

const PRICES: Record<string, string> = {
  sub_49:    "price_1TRM9BGTQMkzV0RdVEPRQomA",
  sub_20:    "price_1TT3vdGTQMkzV0Rdnp2ULx17",
  one_49:    "price_1TWEmnGTQMkzV0Rd0BTukXsh",
  one_20:    "price_1TWEmmGTQMkzV0Rdc2rTCnMW",
  setup_990: "price_1TRMsbGTQMkzV0RdpmrZjopY",
};

async function stripePost(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const params = new URLSearchParams();
  function flatten(obj: unknown, prefix = "") {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) obj.forEach((item, i) => flatten(item, `${prefix}[${i}]`));
    else if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}[${k}]` : k);
    } else params.append(prefix, String(obj));
  }
  flatten(body);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await secret("crm_stripe_secret_key")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.json();
}

const createPrice = async (cents: number, label: string) =>
  (await stripePost("prices", { unit_amount: cents, currency: "eur", product_data: { name: label } })).id as string;
const createRecurringPrice = async (cents: number, label: string) =>
  (await stripePost("prices", { unit_amount: cents, currency: "eur", recurring: { interval: "month" }, product_data: { name: label } })).id as string;

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

    const { type, nbPaiements, customAmount, firstExtra, anchorDay, clientEmail, clientId } = await req.json();
    const origin = req.headers.get("origin") || "https://potentieel.vercel.app";
    const success = `${origin}/admin.html?stripe=success`;
    const cancel = `${origin}/admin.html?stripe=cancel`;

    // Identification de la fiche client, propagée partout où Stripe la conserve.
    const meta = (kind: string, extra: Record<string, string> = {}) => ({
      ...(clientId ? { crm_client_id: String(clientId) } : {}), crm_kind: kind, ...extra,
    });
    const link = async (lineItems: unknown[], kind: string, subMeta?: Record<string, string>) => {
      const p: Record<string, unknown> = {
        restrictions: { completed_sessions: { limit: 1 } },
        after_completion: { type: "redirect", redirect: { url: success } },
        line_items: lineItems,
        metadata: meta(kind),
      };
      if (subMeta) p.subscription_data = { metadata: meta(kind, subMeta) };
      return stripePost("payment_links", p);
    };
    const session = async (lineItems: unknown[], kind: string, trialEnd: number) =>
      stripePost("checkout/sessions", {
        success_url: success, cancel_url: cancel, customer_email: clientEmail || undefined,
        mode: "subscription", line_items: lineItems, metadata: meta(kind),
        subscription_data: { trial_end: trialEnd, metadata: meta(kind) },
      });

    let result: Record<string, any>;
    let isPaymentLink = true;
    const eur = (c: number) => (c / 100).toFixed(2).replace(".", ",");

    switch (type) {
      case "combo_990_49":
        result = await link([{ price: PRICES.sub_49, quantity: 1 }, { price: PRICES.setup_990, quantity: 1 }], "abo", {});
        break;
      case "sub_49":
        result = await link([{ price: PRICES.sub_49, quantity: 1 }], "abo", {});
        break;
      case "sub_20":
        result = await link([{ price: PRICES.sub_20, quantity: 1 }], "abo", {});
        break;
      case "one_49":
        result = await link([{ price: PRICES.one_49, quantity: 1 }], "abo_mois");
        break;
      case "one_20":
        result = await link([{ price: PRICES.one_20, quantity: 1 }], "abo_mois");
        break;
      case "combo_20_sub": {
        isPaymentLink = false;
        const now = new Date();
        const trialEnd = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 7, 0, 0, 0) / 1000);
        result = await session([{ price: PRICES.sub_20, quantity: 1 }, { price: PRICES.one_20, quantity: 1 }], "abo", trialEnd);
        break;
      }
      case "sub_custom": {
        // Montant mensuel libre : 1er mois payé tout de suite (article ponctuel),
        // puis prélèvement chaque mois le jour choisi (trial_end).
        isPaymentLink = false;
        const cents = customAmount ? Math.round(Number(customAmount) * 100) : 0;
        if (!cents || cents < 100) return json({ error: "Montant mensuel invalide (minimum 1 €)." }, 400);
        const label = `Abonnement mensuel — ${eur(cents)}€/mois`;
        const rec = await createRecurringPrice(cents, label);
        const one = await createPrice(cents, `${label} — 1er mois`);
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
            ? await createPrice(oneCents, `Création site Potentieel — ${eur(oneCents)}€`)
            : PRICES.setup_990;
          result = await link([{ price: priceId, quantity: 1 }], "site_1x");
        } else {
          const cents = Math.round(totalCents / n);
          const priceId = await createRecurringPrice(cents, `Création site Potentieel — ${eur(cents)}€/mois (${n}×)`);
          const items: Record<string, unknown>[] = [{ price: priceId, quantity: 1 }];
          if (extraCents > 0) items.push({ price: await createPrice(extraCents, `Supplément 1er versement — ${eur(extraCents)}€`), quantity: 1 });
          result = await link(items, "site_nx", { auto_cancel_after_months: String(n) });
        }
        break;
      }
      case "ads_custom": {
        const cents = customAmount ? Math.round(Number(customAmount) * 100) : 15000;
        result = await link([{ price: await createPrice(cents, `Honoraires Google Ads — ${(cents / 100).toFixed(0)}€`), quantity: 1 }], "ads");
        break;
      }
      default:
        return json({ error: "Unknown type" }, 400);
    }

    if (result.error) return json({ error: result.error.message }, 400);
    const url = isPaymentLink ? withPrefilledEmail(result.url as string, clientEmail) : (result.url as string);
    return json({ url, id: result.id });
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
