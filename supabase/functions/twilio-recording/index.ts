// Twilio recording callback — récupère l'enregistrement (appel ou répondeur),
// l'archive dans Supabase Storage (public) et met à jour ads_calls.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TW_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TW_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const BUCKET = "ads-recordings";

Deno.serve(async (req) => {
  try {
    const form = await req.formData();
    const p: Record<string, string> = {};
    for (const [k, v] of form.entries()) p[k] = String(v);

    const callSid = p.CallSid || "";
    const recSid = p.RecordingSid || "";
    const recUrl = p.RecordingUrl || "";
    const recDur = parseInt(p.RecordingDuration || "0", 10) || 0;
    if (!callSid || !recUrl) return new Response("ok");

    let publicUrl = `${recUrl}.mp3`; // fallback (nécessite auth Twilio)

    // Archive dans Storage si on a les identifiants Twilio.
    if (TW_SID && TW_TOKEN) {
      try {
        const auth = "Basic " + btoa(`${TW_SID}:${TW_TOKEN}`);
        // petite attente : le média peut mettre ~1s à être disponible
        let media: ArrayBuffer | null = null;
        for (let i = 0; i < 4; i++) {
          const r = await fetch(`${recUrl}.mp3`, { headers: { Authorization: auth } });
          if (r.ok) { media = await r.arrayBuffer(); break; }
          await new Promise((res) => setTimeout(res, 800));
        }
        if (media) {
          const path = `${callSid}.mp3`;
          const up = await supabase.storage.from(BUCKET)
            .upload(path, new Uint8Array(media), { contentType: "audio/mpeg", upsert: true });
          if (!up.error) {
            publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
          } else {
            console.error("storage upload error", up.error);
          }
        }
      } catch (e) { console.error("fetch/upload recording error", e); }
    }

    // Etat courant : si l'appel était 'manque', un enregistrement = message vocal laissé.
    const { data: cur } = await supabase.from("ads_calls")
      .select("status, duration_sec").eq("twilio_call_sid", callSid).maybeSingle();
    const patch: Record<string, unknown> = { recording_url: publicUrl, recording_sid: recSid };
    if (cur?.status === "manque") patch.status = "repondeur";
    if (!cur?.duration_sec && recDur) patch.duration_sec = recDur;

    await supabase.from("ads_calls").update(patch).eq("twilio_call_sid", callSid);
    return new Response("ok");
  } catch (e) {
    console.error("twilio-recording error", e);
    return new Response("ok");
  }
});
