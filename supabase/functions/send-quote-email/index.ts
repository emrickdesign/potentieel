import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

/*
 * send-quote-email — envoie un devis PDF (base64) au client depuis le Gmail de l'agence.
 * Réservée à l'équipe (table potentieel_equipe) : la clé anon publique ne suffit plus,
 * sinon n'importe qui pourrait envoyer des mails depuis notre adresse.
 * Aucun secret en dur : mot de passe Gmail lu dans l'env ou le Vault (crm_gmail_app_password).
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);

  try {
    const { to, clientName, ref, totalTxt, pdfBase64, fileName, senderName } = (await req.json()) || {};
    if (!to || !pdfBase64) return json({ error: "Champs requis manquants (to, pdfBase64)." }, 400);

    const refTxt = ref || "";
    const montantTxt = totalTxt ? ` d'un montant de ${totalTxt}` : "";
    const textBody =
`Bonjour ${clientName || "Client"},

Veuillez trouver ci-joint votre devis ${refTxt}${montantTxt}.

Ce devis est valable 5 jours à compter de sa date d'émission. N'hésitez pas à nous contacter en répondant directement à cet email pour toute question, ou pour valider la proposition.

Merci de votre confiance,

${senderName || "Emrick"} — Potentieel
potentieel.web@gmail.com · potentieel.fr`;

    const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
      auth: { username: GMAIL_USER, password: await secret("crm_gmail_app_password") } } });
    await client.send({
      from: `Potentieel <${GMAIL_USER}>`, to, replyTo: GMAIL_USER,
      subject: `Votre devis ${refTxt} — Potentieel`.trim(),
      content: textBody,
      attachments: [{ filename: fileName || `devis-${refTxt || "potentieel"}.pdf`, content: pdfBase64, encoding: "base64", contentType: "application/pdf" }],
    });
    await client.close();
    return json({ success: true });
  } catch (e) {
    console.error("send-quote-email error:", e);
    return json({ error: String(e) }, 500);
  }
});
