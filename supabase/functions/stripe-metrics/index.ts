import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * stripe-metrics — MRR et setup cumule lus en direct chez Stripe.
 *
 * Subtilite propre a ce compte : un paiement de site en plusieurs fois est
 * implemente comme un abonnement Stripe temporaire (990 EUR -> 4 x 247,50
 * avec metadata.auto_cancel_after_months). Ces abonnements-la ne sont PAS du
 * revenu recurrent : les compter dans le MRR le gonfle artificiellement et le
 * fait chuter des la derniere echeance. On les classe en setup.
 *
 * Lecture seule. Réservée à l'équipe (table potentieel_equipe) : sans ce
 * contrôle, la clé anon publique du site suffisait à lire le chiffre d'affaires.
 */

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type AnyObj = Record<string, any>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
async function requireTeam(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  const email = (user?.email ?? "").toLowerCase();
  if (!email) return null;
  const { data } = await admin.from("potentieel_equipe").select("email").eq("email", email).maybeSingle();
  return data ? email : null;
}

async function stripeGet(path: string): Promise<AnyObj> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${body?.error?.message ?? "erreur inconnue"}`);
  return body;
}

async function pageAll(resource: string, params: Record<string, string>): Promise<AnyObj[]> {
  const all: AnyObj[] = [];
  let startingAfter = "";
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ ...params, limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);
    const res = await stripeGet(`${resource}?${qs}`);
    const data = (res.data as AnyObj[]) ?? [];
    all.push(...data);
    if (!res.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return all;
}

function toMonthly(unitAmount: number, quantity: number, interval: string, intervalCount: number): number {
  const perPeriod = (unitAmount / 100) * (quantity || 1);
  const n = intervalCount || 1;
  switch (interval) {
    case "year":  return perPeriod / (12 * n);
    case "month": return perPeriod / n;
    case "week":  return (perPeriod * 52) / (12 * n);
    case "day":   return (perPeriod * 365) / (12 * n);
    default:      return 0;
  }
}

const estPaiementEtale = (sub: AnyObj) => Number((sub.metadata ?? {}).auto_cancel_after_months || 0) > 0;
const subDeFacture = (inv: AnyObj): string | null => inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);
  if (!STRIPE_KEY) return json({ error: "STRIPE_SECRET_KEY absente des secrets de la fonction." }, 500);

  let months = 12;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.months)) months = Math.min(Math.max(Number(body.months), 1), 60);
  } catch { /* corps vide : 12 mois */ }

  const since = Math.floor(Date.now() / 1000) - months * 31 * 24 * 3600;

  try {
    const [subs, invoices, charges] = await Promise.all([
      pageAll("subscriptions", { status: "all" }),
      pageAll("invoices", { status: "paid", "created[gte]": String(since) }),
      pageAll("charges", { "created[gte]": String(since) }),
    ]);

    const etale = new Set<string>();
    for (const s of subs) if (estPaiementEtale(s)) etale.add(String(s.id));

    let mrr = 0;
    const abonnes = new Set<string>();
    for (const sub of subs) {
      if (sub.status !== "active" && sub.status !== "trialing") continue;
      if (sub.cancel_at_period_end) continue;
      if (etale.has(String(sub.id))) continue;
      for (const item of (sub.items?.data ?? []) as AnyObj[]) {
        const price = item.price ?? {};
        const rec = price.recurring ?? {};
        if (!rec.interval) continue;
        mrr += toMonthly(price.unit_amount ?? 0, item.quantity ?? 1, rec.interval, rec.interval_count ?? 1);
      }
      if (sub.customer) abonnes.add(String(sub.customer));
    }

    // charge.invoice etant toujours nul ici, on soustrait le recurrent du total encaisse.
    let recurrentEncaisse = 0;
    for (const inv of invoices) {
      const subId = subDeFacture(inv);
      if (!subId) continue;
      if (etale.has(String(subId))) continue;
      recurrentEncaisse += (inv.amount_paid ?? 0) / 100;
    }

    let totalEncaisse = 0;
    let nbPaiements = 0;
    for (const ch of charges) {
      if (ch.paid !== true || ch.status !== "succeeded") continue;
      const net = (ch.amount ?? 0) - (ch.amount_refunded ?? 0);
      if (net <= 0) continue;
      totalEncaisse += net / 100;
      nbPaiements++;
    }

    const setup = Math.max(0, totalEncaisse - recurrentEncaisse);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return json({
      ok: true, mrr: r2(mrr), arr: r2(mrr * 12), abonnes: abonnes.size, setup: r2(setup),
      encaisse_total: r2(totalEncaisse), encaisse_recurrent: r2(recurrentEncaisse), paiements: nbPaiements, months,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("stripe-metrics: erreur —", msg);
    return json({ error: msg }, 500);
  }
});
