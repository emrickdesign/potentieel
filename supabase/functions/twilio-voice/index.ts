// Twilio Voice webhook — appel entrant sur un numéro de suivi.
// Transfère vers le numéro réel du client + enregistre l'appel.
// Le client entend « Appel provenant de Google Ads » en décrochant (twilio-whisper).
// Si pas de réponse -> répondeur (voir twilio-status).
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const FN_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

function digits(s: string) { return String(s || "").replace(/[^0-9]/g, ""); }

Deno.serve(async (req) => {
  try {
    const form = await req.formData();
    const p: Record<string, string> = {};
    for (const [k, v] of form.entries()) p[k] = String(v);

    const from = p.From || "";
    const to = p.To || "";
    const callSid = p.CallSid || "";

    // Retrouve le client par son numéro de suivi (comparaison sur les chiffres).
    const toD = digits(to);
    const { data: clients } = await supabase.from("crm_clients")
      .select("id, telephone_reel, twilio_number, entreprise, nom").eq("type", "ads").eq("actif", true);
    const client = (clients || []).find((c: any) => c.twilio_number && digits(c.twilio_number) === toD)
      || (clients || []).find((c: any) => c.twilio_number && toD.endsWith(digits(c.twilio_number)));

    // Trace l'appel (statut initial).
    await supabase.from("ads_calls").upsert({
      twilio_call_sid: callSid,
      client_id: client?.id || null,
      from_number: from,
      to_number: to,
      status: "en-cours",
    }, { onConflict: "twilio_call_sid" });

    // Pas de client rattaché / pas de numéro cible -> message + fin.
    if (!client || !client.telephone_reel) {
      return xml(`<Say language="fr-FR" voice="Polly.Lea">Bonjour, votre correspondant n'est pas joignable pour le moment. Merci de rappeler ultérieurement.</Say><Hangup/>`);
    }

    const action = `${FN_BASE}/twilio-status`;
    const recCb = `${FN_BASE}/twilio-recording`;
    const whisper = `${FN_BASE}/twilio-whisper`;
    // Transfert + enregistrement des deux voix. action() est rappelé à la fin du Dial.
    return xml(
      `<Dial timeout="22" answerOnBridge="true" record="record-from-answer-dual" ` +
      `recordingStatusCallback="${recCb}" recordingStatusCallbackEvent="completed" ` +
      `action="${action}" method="POST" callerId="${to}">` +
      `<Number url="${whisper}" method="POST">${client.telephone_reel}</Number></Dial>`
    );
  } catch (e) {
    console.error("twilio-voice error", e);
    return xml(`<Say language="fr-FR" voice="Polly.Lea">Une erreur est survenue.</Say><Hangup/>`);
  }
});
