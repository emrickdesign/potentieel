import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * calendly-sync — importe les RDV Calendly dans la table `calls`.
 * Remplace l'appel direct depuis admin.html, qui exposait le jeton Calendly à
 * n'importe quel visiteur de la page. Le jeton est lu côté serveur :
 * env CRM_CALENDLY_TOKEN (prioritaire) ou Vault crm_calendly_token.
 * Réservée à l'équipe (table potentieel_equipe).
 * Fenêtre : 45 jours passés → 90 jours à venir. RDV actifs upsertés sur
 * calendly_uuid ; RDV annulés côté Calendly supprimés du CRM.
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
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function cal(url: string, token: string): Promise<AnyObj> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Calendly ${res.status}: ${out?.message || out?.title || "erreur"}`);
  return out;
}

async function listEvents(token: string, userUri: string, status: string, min: string, max: string): Promise<AnyObj[]> {
  const all: AnyObj[] = [];
  let url: string | null = `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&status=${status}&min_start_time=${min}&max_start_time=${max}&count=100`;
  for (let i = 0; url && i < 10; i++) {
    const page = await cal(url, token);
    all.push(...(page.collection ?? []));
    url = page.pagination?.next_page ?? null;
  }
  return all;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);

  try {
    const token = await secret("crm_calendly_token");
    const me = await cal("https://api.calendly.com/users/me", token);
    const userUri = me.resource?.uri;
    if (!userUri) throw new Error("Utilisateur Calendly introuvable");

    const min = new Date(Date.now() - 45 * 86400000).toISOString();
    const max = new Date(Date.now() + 90 * 86400000).toISOString();
    const [active, canceled] = await Promise.all([
      listEvents(token, userUri, "active", min, max),
      listEvents(token, userUri, "canceled", min, max),
    ]);

    let upserted = 0;
    for (const ev of active) {
      const uid = String(ev.uri).split("/").pop();
      let name = "Inconnu", email: string | null = null;
      try {
        const inv = (await cal(`${ev.uri}/invitees?count=1`, token)).collection?.[0];
        if (inv) { name = inv.name || name; email = inv.email || null; }
      } catch { /* invité illisible : on garde le RDV */ }
      const { error } = await admin.from("calls").upsert({
        calendly_uuid: uid, source: "calendly", name, email, scheduled_at: ev.start_time,
        status: new Date(ev.start_time) > new Date() ? "upcoming" : "past",
      }, { onConflict: "calendly_uuid" });
      if (!error) upserted++;
    }

    const canceledIds = canceled.map((ev) => String(ev.uri).split("/").pop()).filter(Boolean);
    let removed = 0;
    if (canceledIds.length) {
      const { count } = await admin.from("calls").delete({ count: "exact" }).in("calendly_uuid", canceledIds);
      removed = count ?? 0;
    }
    return json({ ok: true, upserted, removed });
  } catch (e) {
    console.log("calendly-sync:", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
