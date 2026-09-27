import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/*
 * send-call-reminders — appelée toutes les 15 min par un cron pg_net.
 * Envoie un mail de rappel aux prospects (appels ajoutés manuellement dans le
 * CRM, avec un email renseigné) :
 *  - un rappel dès que l'appel est à 24 h ou moins (« la veille »)
 *  - un rappel dès que l'appel est à 1 h ou moins (« le jour même »)
 * Idempotent via reminder_24h_sent_at / reminder_dayof_sent_at. Si l'appel est
 * créé moins de 24 h avant, seul le rappel « dans l'heure » part.
 * Le client SMTP n'est ouvert que s'il y a un email à envoyer (sinon denomailer
 * plante à la fermeture d'une connexion jamais ouverte).
 * Protégée par l'en-tête x-cron-secret (verify_jwt=false). Aucun secret en dur :
 * crm_cron_secret et crm_gmail_app_password sont lus dans l'env ou le Vault.
 */

const GMAIL_USER = "potentieel.web@gmail.com";
const HOUR = 3600000;
const DAY = 24 * HOUR;
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

function fmtFR(iso: string): { dateTxt: string; timeTxt: string } {
  try {
    const d = new Date(iso);
    return {
      dateTxt: new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(d),
      timeTxt: new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(d),
    };
  } catch {
    return { dateTxt: "", timeTxt: "" };
  }
}

async function newClient(): Promise<SMTPClient> {
  return new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
    auth: { username: GMAIL_USER, password: await secret("crm_gmail_app_password") } } });
}

async function sendReminder(client: SMTPClient, to: string, name: string, iso: string, kind: "j1" | "h1") {
  const { dateTxt, timeTxt } = fmtFR(iso);
  const safeName = (name && String(name).trim()) || "";
  const greeting = safeName ? `Bonjour ${safeName},` : "Bonjour,";
  const whenLine = (dateTxt && timeTxt) ? `${dateTxt} à ${timeTxt}` : "à la date convenue";
  const subject = kind === "h1"
    ? "Rappel — votre appel avec Potentieel dans moins d'une heure"
    : "Rappel — votre appel avec Potentieel à venir";
  const textBody =
`${greeting}

Petit rappel concernant notre rendez-vous téléphonique :

  📅  ${whenLine}

Nous vous appellerons directement à ce moment-là pour échanger sur votre projet.

Si vous devez décaler ou annuler, il vous suffit de répondre à cet email — on s'arrange sans souci.

À très vite,

Emrick — Potentieel
potentieel.web@gmail.com · potentieel.fr`;
  await client.send({ from: `Potentieel <${GMAIL_USER}>`, to, replyTo: GMAIL_USER, subject, content: textBody });
}

Deno.serve(async (req: Request) => {
  const got = req.headers.get("x-cron-secret") || "";
  let expected = "";
  try { expected = await secret("crm_cron_secret"); } catch (e) { console.log("send-call-reminders:", String(e)); }
  if (!expected || !safeEqual(got, expected)) return new Response("forbidden", { status: 403 });

  try {
    const now = new Date();
    const { data: calls, error } = await admin
      .from("calls")
      .select("id,name,email,scheduled_at,source,reminder_24h_sent_at,reminder_dayof_sent_at")
      .eq("source", "manuel")
      .not("email", "is", null)
      .gt("scheduled_at", now.toISOString());
    if (error) throw new Error(error.message);

    let sentJ1 = 0, sentH1 = 0;
    let client: SMTPClient | null = null;

    for (const c of (calls ?? [])) {
      if (c.reminder_24h_sent_at && c.reminder_dayof_sent_at) continue;
      const msUntil = new Date(c.scheduled_at).getTime() - now.getTime();
      if (msUntil <= 0) continue;

      if (msUntil <= HOUR) {
        if (!c.reminder_dayof_sent_at) {
          if (!client) client = await newClient();
          await sendReminder(client, c.email, c.name, c.scheduled_at, "h1");
          await admin.from("calls").update({
            reminder_dayof_sent_at: now.toISOString(),
            reminder_24h_sent_at: c.reminder_24h_sent_at ?? now.toISOString(),
          }).eq("id", c.id);
          sentH1++;
        }
      } else if (msUntil <= DAY) {
        if (!c.reminder_24h_sent_at) {
          if (!client) client = await newClient();
          await sendReminder(client, c.email, c.name, c.scheduled_at, "j1");
          await admin.from("calls").update({ reminder_24h_sent_at: now.toISOString() }).eq("id", c.id);
          sentJ1++;
        }
      }
    }

    if (client) await (client as SMTPClient).close();
    return new Response(JSON.stringify({ ok: true, sentJ1, sentH1, checked: (calls ?? []).length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.log("send-call-reminders:", e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
