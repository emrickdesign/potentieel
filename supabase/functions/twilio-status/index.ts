// Twilio Dial action callback — fin de la tentative de transfert.
// Répond à Twilio IMMÉDIATEMENT ; la maj DB + le mail se font en arrière-plan (waitUntil).
// Aucun secret en dur : le mot de passe Gmail vient de l'env (GMAIL_APP_PASSWORD)
// ou du Vault (crm_gmail_app_password).
import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const AGENCY_EMAIL = Deno.env.get("AGENCY_NOTIFY_EMAIL") || "emrick.perilliat2006@gmail.com";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "";
const GMAIL_USER = Deno.env.get("GMAIL_USER") || "potentieel.web@gmail.com";

let _gmailPwd = "";
async function gmailPassword(): Promise<string> {
  if (_gmailPwd) return _gmailPwd;
  const env = Deno.env.get("GMAIL_APP_PASSWORD");
  if (env) return (_gmailPwd = env);
  const { data, error } = await supabase.rpc("crm_secret_get", { p_name: "crm_gmail_app_password" });
  if (error || !data) throw new Error("Mot de passe Gmail introuvable (env ou Vault)");
  return (_gmailPwd = String(data));
}

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

// Exécute une tâche en arrière-plan sans bloquer la réponse HTTP.
function background(p: Promise<unknown>) {
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* noop */ }
}

async function sendMail(to: string, subject: string, text: string) {
  try {
    if (RESEND_API_KEY && RESEND_FROM) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: RESEND_FROM, to, subject, text }),
      });
      if (r.ok) return;
      console.error("resend failed", await r.text());
    }
    const client = new SMTPClient({ connection: {
      hostname: "smtp.gmail.com", port: 465, tls: true,
      auth: { username: GMAIL_USER, password: await gmailPassword() } } });
    await client.send({ from: `Potentieel <${GMAIL_USER}>`, to, replyTo: GMAIL_USER, subject, content: text });
    await client.close();
  } catch (e) { console.error("sendMail error", e); }
}

async function handleMissed(callSid: string, from: string) {
  await supabase.from("ads_calls").update({ status: "manque" }).eq("twilio_call_sid", callSid);
  const { data: call } = await supabase.from("ads_calls")
    .select("client_id").eq("twilio_call_sid", callSid).maybeSingle();
  let clientName = "", clientEmail = "", notifyClient = false;
  if (call?.client_id) {
    const { data: c } = await supabase.from("crm_clients")
      .select("entreprise, nom, email, notify_email").eq("id", call.client_id).maybeSingle();
    clientName = c?.entreprise || c?.nom || "";
    clientEmail = c?.email || "";
    notifyClient = !!c?.notify_email;
  }
  const subject = `☎️ Appel manqué${clientName ? " — " + clientName : ""} : ${from}`;
  const body = `Un prospect a appelé le numéro de suivi${clientName ? " de " + clientName : ""} sans obtenir de réponse.\n\n☎️ Numéro à rappeler : ${from}\n🕒 ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}\n\nRappelez ce prospect au plus vite.`;
  await sendMail(AGENCY_EMAIL, subject, body);
  if (notifyClient && clientEmail) {
    await sendMail(clientEmail, `☎️ Appel manqué : ${from}`,
      `Vous avez reçu un appel auquel vous n'avez pas pu répondre.\n\n☎️ Numéro à rappeler : ${from}\n\nRetrouvez vos demandes : https://potentieel.fr/espace-client`);
  }
}

// Appel décroché : marque « répondu » + durée. (Le builder Supabase est paresseux :
// il faut l'awaiter dans une vraie promesse, sinon la requête ne part jamais.)
async function handleAnswered(callSid: string, dur: number) {
  const { error } = await supabase.from("ads_calls")
    .update({ status: "repondu", duration_sec: dur }).eq("twilio_call_sid", callSid);
  if (error) console.error("handleAnswered error", error);
}

Deno.serve(async (req) => {
  try {
    const form = await req.formData();
    const p: Record<string, string> = {};
    for (const [k, v] of form.entries()) p[k] = String(v);

    const callSid = p.CallSid || "";
    const dialStatus = p.DialCallStatus || "";
    const from = p.From || "";
    const dur = parseInt(p.DialCallDuration || "0", 10) || 0;

    if (dialStatus === "completed") {
      background(handleAnswered(callSid, dur));
      return xml(`<Hangup/>`);
    }

    // Non décroché : maj + mail en arrière-plan, réponse immédiate (répondeur).
    background(handleMissed(callSid, from));
    return xml(
      `<Say language="fr-FR" voice="Polly.Lea">Bonjour, nous ne sommes pas disponibles pour le moment. Laissez votre message après le bip, nous vous rappellerons rapidement.</Say>` +
      `<Record maxLength="120" timeout="5" playBeep="true" ` +
      `recordingStatusCallback="${Deno.env.get("SUPABASE_URL")}/functions/v1/twilio-recording" recordingStatusCallbackEvent="completed" />` +
      `<Hangup/>`
    );
  } catch (e) {
    console.error("twilio-status error", e);
    return xml(`<Hangup/>`);
  }
});
