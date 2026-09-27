import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * stripe-sync — depuis le passage aux fiches clients pour les ENTREES, cette
 * fonction n'importe plus les encaissements Stripe (le CA vient des fiches).
 * Elle ne remonte QUE les FRAIS Stripe (depenses) et les VIREMENTS Stripe ->
 * compte pro (transferts neutres). Ainsi « Sync Stripe » ne cree aucun doublon
 * avec le CA des fiches.
 * Réservée à l'équipe (table potentieel_equipe) : la clé anon publique ne suffit pas.
 */

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AnyObj = Record<string, any>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function requireTeam(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await admin.auth.getUser(token);
  const email = (user?.email ?? "").toLowerCase();
  if (!email) return null;
  const { data } = await admin.from("potentieel_equipe").select("email").eq("email", email).maybeSingle();
  return data ? email : null;
}

const cents = (n: number) => Math.round(Math.abs(n || 0)) / 100;
const isoDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

async function stripeGet(path: string): Promise<AnyObj> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${STRIPE_KEY}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${body?.error?.message ?? "erreur inconnue"}`);
  return body;
}

async function fetchBalanceTransactions(since: number): Promise<AnyObj[]> {
  const all: AnyObj[] = [];
  let startingAfter = "";
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
    qs.append("expand[]", "data.source");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const res = await stripeGet(`balance_transactions?${qs}`);
    const data = (res.data as AnyObj[]) ?? [];
    all.push(...data);
    if (!res.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return all;
}

function describe(txn: AnyObj): string {
  const src = txn.source;
  if (src && typeof src === "object") {
    const who = src.billing_details?.name || src.billing_details?.email || src.customer_email || "";
    const what = src.description || txn.description || "";
    if (who && what) return `${who} — ${what}`;
    if (who) return who;
    if (what) return what;
  }
  return txn.description || "Stripe";
}

/*
 * On ne garde que les frais (depenses) et les virements (transferts). Les
 * encaissements et remboursements sont ignores : le CA est tenu par les fiches.
 */
function mapTxn(txn: AnyObj): AnyObj[] {
  const date = isoDay(txn.created);
  const rows: AnyObj[] = [];
  const base = { source: "stripe", date };

  switch (txn.type) {
    case "charge":
    case "payment": {
      if (txn.fee > 0) {
        rows.push({ ...base, type: "sortie", amount: cents(txn.fee), category: "banque",
          description: "Frais Stripe", external_id: `${txn.id}:fee`, notes: describe(txn) });
      }
      break;
    }
    case "payout": {
      rows.push({ ...base, type: "transfert", amount: cents(txn.amount), category: "autre",
        description: "Virement Stripe → compte pro", external_id: txn.id, notes: "Transfert interne — exclu des totaux" });
      break;
    }
    case "stripe_fee":
    case "billing_fee":
    case "application_fee": {
      rows.push({ ...base, type: "sortie", amount: cents(txn.amount), category: "banque",
        description: describe(txn) || "Frais Stripe", external_id: txn.id, notes: "Frais Stripe" });
      break;
    }
  }
  return rows.filter((r) => r.amount > 0);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);
  if (!STRIPE_KEY) return json({ error: "STRIPE_SECRET_KEY absente des secrets de la fonction." }, 500);

  let months = 12;
  try { const body = await req.json(); if (Number.isFinite(body?.months)) months = Math.min(Math.max(Number(body.months), 1), 36); } catch { /* 12 */ }
  const since = Math.floor(Date.now() / 1000) - months * 31 * 24 * 3600;

  try {
    const txns = await fetchBalanceTransactions(since);
    const rows = txns.flatMap(mapTxn);
    if (rows.length === 0) return json({ ok: true, scanned: txns.length, imported: 0, skipped: 0 });

    const ids = rows.map((r) => r.external_id);
    const existing = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from("transactions").select("external_id").in("external_id", ids.slice(i, i + 200));
      if (error) throw new Error(`Lecture transactions : ${error.message}`);
      (data ?? []).forEach((r: AnyObj) => existing.add(r.external_id));
    }
    const fresh = rows.filter((r) => !existing.has(r.external_id));
    if (fresh.length > 0) {
      const { error } = await admin.from("transactions").insert(fresh);
      if (error) throw new Error(`Insertion transactions : ${error.message}`);
    }
    return json({ ok: true, scanned: txns.length, imported: fresh.length, skipped: rows.length - fresh.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("stripe-sync: erreur —", msg);
    return json({ error: msg }, 500);
  }
});
