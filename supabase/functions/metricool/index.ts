// Passerelle vers l'API Metricool (posts Google Business Profile, avis, réseaux sociaux).
// PRÊTE MAIS INACTIVE : l'API Metricool exige le plan Advanced. Tant que METRICOOL_USER_TOKEN
// (+ METRICOOL_USER_ID) n'est pas posé dans les secrets Supabase, chaque action répond
// « not_configured » et l'interface affiche le bandeau « API à activer ».
// TODO à l'activation du plan : brancher les appels (posts, avis, réponse) après avoir
// vérifié les endpoints dans la doc Metricool — ne pas deviner leur forme.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MC_TOKEN = Deno.env.get("METRICOOL_USER_TOKEN");
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

    if (!MC_TOKEN) {
      return json({ configured: false, message: "API Metricool non activée (plan Advanced + clé requis)." });
    }
    const { action } = await req.json();
    if (action === "status") return json({ configured: true });
    return json({ configured: true, error: `Action « ${action} » pas encore branchée.` }, 501);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
