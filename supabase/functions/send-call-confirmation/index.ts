import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/*
 * send-call-confirmation — email de confirmation de RDV au prospect, à l'ajout
 * manuel d'un appel dans le CRM. Réservée à l'équipe (table potentieel_equipe).
 * Aucun secret en dur : mot de passe Gmail lu dans l'env ou le Vault.
 */

const GMAIL_USER = "potentieel.web@gmail.com";
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);

  try {
    let { to, clientName, dateTxt, timeTxt, scheduledAt } = (await req.json()) || {};
    if (!to) return json({ error: "Champ requis manquant (to)." }, 400);

    // Date/heure recalculées en heure de Paris depuis l'ISO si non fournies.
    if ((!dateTxt || !timeTxt) && scheduledAt) {
      const f = fmtFR(scheduledAt);
      dateTxt = dateTxt || f.dateTxt;
      timeTxt = timeTxt || f.timeTxt;
    }

    const safeName = (clientName && String(clientName).trim()) || "";
    const greeting = safeName ? `Bonjour ${safeName},` : "Bonjour,";
    const whenLine = (dateTxt && timeTxt) ? `${dateTxt} à ${timeTxt}` : (dateTxt || timeTxt || "à la date convenue");
    const subject = `Votre rendez-vous avec Potentieel${dateTxt ? " — " + dateTxt : ""}`;

    const textBody =
`${greeting}

C'est confirmé : nous avons bien noté notre rendez-vous téléphonique.

  📅  ${whenLine}

Nous vous appellerons directement à ce moment-là pour échanger sur votre projet et voir comment nous pouvons vous aider.

Si vous devez décaler ou annuler, il vous suffit de répondre à cet email — on s'arrange sans souci.

À très vite,

Emrick — Potentieel
potentieel.web@gmail.com · potentieel.fr`;

    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
      auth: { username: GMAIL_USER, password: await secret("crm_gmail_app_password") } } });
    await client.send({ from: `Potentieel <${GMAIL_USER}>`, to, replyTo: GMAIL_USER, subject, content: textBody });
    await client.close();
    return json({ success: true });
  } catch (e) {
    console.error("send-call-confirmation error:", e);
    return json({ error: String(e) }, 500);
  }
});
