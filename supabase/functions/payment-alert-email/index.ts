import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/*
 * payment-alert-email — appelée chaque matin par un cron. Lit les fiches
 * clients ; si un versement de site est dû DANS 3 JOURS (prochain versement
 * non coché), envoie un email d'alerte à l'équipe (table potentieel_equipe).
 * Protégée par l'en-tête x-cron-secret (verify_jwt=false). `?test=1` force
 * l'envoi même sans échéance (pour vérifier le canal) — secret toujours exigé.
 * Aucun secret en dur : lus dans l'env ou le Vault.
 */

const GMAIL_USER = "potentieel.web@gmail.com";
const DAY = 86400000;
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
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function parisTodayUTC(): number {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
const fmtDateFR = (utc: number) => new Date(utc).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const test = url.searchParams.get("test") === "1";
  const got = req.headers.get("x-cron-secret") || "";
  let expected = "";
  try { expected = await secret("crm_cron_secret"); } catch (e) { console.log("payment-alert-email:", String(e)); }
  if (!expected || !safeEqual(got, expected)) return new Response("forbidden", { status: 403 });

  try {
    const { data: items, error } = await admin.from("crm_items").select("payload").eq("section", "clients");
    if (error) throw new Error(error.message);

    const today = parisTodayUTC();
    const due: AnyObj[] = [];
    for (const it of (items ?? [])) {
      const c = (it.payload ?? {}) as AnyObj;
      if (!c.sitePlan || !c.siteFirstPayDate) continue;
      const n = parseInt(c.sitePlan) || 0;
      const vers = Array.isArray(c.siteVersements) ? c.siteVersements : [];
      const idx = vers.findIndex((v: boolean) => !v);
      if (idx === -1) continue;
      const [fy, fm, fd] = String(c.siteFirstPayDate).split("-").map(Number);
      const D = Date.UTC(fy, (fm - 1) + idx, fd);
      if (Math.round((D - today) / DAY) === 3) {
        const total = (typeof c.sitePrix === "number" && c.sitePrix > 0) ? c.sitePrix : 990;
        const unit = n > 0 ? Math.round((total / n) * 100) / 100 : 0;
        due.push({ nom: c.nom || "Client", num: idx + 1, n, unit, date: fmtDateFR(D) });
      }
    }

    if (due.length === 0 && !test) return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { "Content-Type": "application/json" } });

    const { data: team } = await admin.from("potentieel_equipe").select("email");
    const recipients = (team ?? []).map((t: AnyObj) => String(t.email)).filter(Boolean);
    if (!recipients.length) throw new Error("Aucun destinataire dans potentieel_equipe");

    const lignes = (due.length ? due : [{ nom: "(test)", num: 1, n: 4, unit: 247.5, date: fmtDateFR(today + 3 * DAY) }])
      .map((a) => `• ${a.nom} — versement ${a.num}/${a.n} de ${a.unit.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €, prévu le ${a.date} (dans 3 jours)`)
      .join("\n");

    const textBody =
`Bonjour,

Rappel — paiement(s) de site à encaisser dans 3 jours :

${lignes}

Pense à vérifier la réception, puis coche le versement sur la fiche client dans le CRM.

— Alerte automatique Potentieel`;

    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
      auth: { username: GMAIL_USER, password: await secret("crm_gmail_app_password") } } });
    await client.send({
      from: `Potentieel <${GMAIL_USER}>`, to: recipients, replyTo: GMAIL_USER,
      subject: `⚠ ${due.length || 1} paiement(s) de site à encaisser sous 3 jours`,
      content: textBody,
    });
    await client.close();

    return new Response(JSON.stringify({ ok: true, sent: recipients.length, alertes: due.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.log("payment-alert-email:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
