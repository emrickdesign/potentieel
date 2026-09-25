// Transcrit l'enregistrement d'un appel (Deepgram) puis, si une clé Anthropic est posée,
// en tire un résumé + un thème. Réservé à l'équipe. PRÊT MAIS INACTIF tant que
// DEEPGRAM_API_KEY n'est pas posée dans les secrets Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPGRAM = Deno.env.get("DEEPGRAM_API_KEY");
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY");
const ADMIN_EMAILS = ["emrick.perilliat2006@gmail.com", "eloisecld73@gmail.com"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(URL, SERVICE);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(token);
    if (!ADMIN_EMAILS.includes(u?.user?.email || "")) return json({ error: "forbidden" }, 403);

    if (!DEEPGRAM) {
      return json({ error: "not_configured", message: "Transcription automatique non activée (clé DEEPGRAM_API_KEY absente)." }, 503);
    }

    const { call_id } = await req.json();
    const { data: call } = await db.from("ads_calls").select("*").eq("id", call_id).maybeSingle();
    if (!call?.recording_url) return json({ error: "Pas d'enregistrement pour cet appel." }, 400);

    const dg = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3&language=fr&smart_format=true&punctuate=true&multichannel=true&utterances=true",
      {
        method: "POST",
        headers: { Authorization: `Token ${DEEPGRAM}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: call.recording_url }),
      },
    );
    if (!dg.ok) return json({ error: "Deepgram : " + (await dg.text()) }, 502);
    const r = await dg.json();
    const utts: { channel: number; transcript: string }[] = r?.results?.utterances || [];
    const transcript = utts.length
      ? utts.map((x) => `Voix ${x.channel + 1} : ${x.transcript}`).join("\n")
      : (r?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "");

    const patch: Record<string, unknown> = { transcript, transcribed_at: new Date().toISOString() };

    if (ANTHROPIC && transcript) {
      const a = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 400,
          messages: [{
            role: "user",
            content:
              "Voici la transcription d'un appel d'un prospect à une entreprise artisanale (issu d'une pub Google Ads). " +
              'Réponds UNIQUEMENT en JSON : {"theme":"corps de métier ou besoin en 1 à 3 mots","summary":"résumé en 2 phrases max"}.\n\n' +
              transcript,
          }],
        }),
      });
      if (a.ok) {
        try {
          const txt = (await a.json()).content?.[0]?.text || "";
          const j = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
          patch.summary = j.summary || null;
          if (!call.theme && j.theme) patch.theme = j.theme;
        } catch { /* résumé facultatif */ }
      }
    }

    const up = await db.from("ads_calls").update(patch).eq("id", call_id).select().single();
    if (up.error) return json({ error: up.error.message }, 400);
    return json({ ok: true, call: up.data });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
