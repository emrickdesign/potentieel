import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

/*
 * notify-lead — Web Push à chaque nouveau lead. Appelée par le trigger
 * notify_new_lead sur form_submissions (pg_net), protégée par l'en-tête
 * x-webhook-secret. Aucun secret en dur : crm_push_webhook_secret et
 * crm_vapid_private sont lus dans l'env ou le Vault.
 */

const VAPID_PUBLIC = "BNbQNuhCzoatf8yJfEhE7rtUU9CtP_e02MLInL7J5RHkuFmexp0DsOeeJFGsh6L2OaY4s3UXHGyTJyRqXZQTvT8"; // clé publique
const VAPID_SUBJECT = "mailto:potentieel.web@gmail.com";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const _sec: Record<string, string> = {};
async function secret(name: string): Promise<string> {
  const env = Deno.env.get(name.toUpperCase());
  if (env) return env;
  if (_sec[name]) return _sec[name];
  const { data, error } = await supabase.rpc("crm_secret_get", { p_name: name });
  if (error || !data) throw new Error(`Secret ${name} introuvable`);
  return (_sec[name] = String(data));
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

let vapidReady = false;

Deno.serve(async (req) => {
  try {
    const expected = await secret("crm_push_webhook_secret");
    if (!safeEqual(req.headers.get("x-webhook-secret") || "", expected)) {
      return new Response("unauthorized", { status: 401 });
    }
    if (!vapidReady) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, await secret("crm_vapid_private"));
      vapidReady = true;
    }

    const body = await req.json().catch(() => ({}));
    const r = body.record || body.row || body || {};
    const prenom = String(r.prenom || "").trim();
    const tel = String(r.telephone || "").trim();
    const domaine = String(r.domaine || "").trim();
    const entreprise = String(r.entreprise || "").trim();
    const id = r.id;

    const lignes: string[] = [];
    if (tel) lignes.push("📞 " + tel);
    const meta = [domaine, entreprise].filter(Boolean).join(" · ");
    if (meta) lignes.push(meta);
    lignes.push("👉 Touche pour rappeler");

    const payload = JSON.stringify({
      title: "🔥 Nouveau lead" + (prenom ? " — " + prenom : ""),
      body: lignes.join("\n"),
      tel,
      url: id ? "/admin.html#lead=ld_fs_" + id : "/admin.html#leads",
      tag: id ? "lead-" + id : "lead",
    });

    const { data: subs, error } = await supabase.from("crm_push_subscriptions").select("*");
    if (error) throw error;

    let sent = 0, removed = 0;
    await Promise.all((subs || []).map(async (s: any) => {
      const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: "high" });
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("crm_push_subscriptions").delete().eq("endpoint", s.endpoint);
          removed++;
        }
      }
    }));

    return new Response(JSON.stringify({ ok: true, sent, removed, total: subs?.length || 0 }), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
