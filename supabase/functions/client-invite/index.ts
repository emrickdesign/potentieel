// Crée un compte espace client (auth user + ligne crm_clients). Réservé à l'équipe.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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
    const admin = createClient(URL, SERVICE);

    // Contrôle que l'appelant est bien un admin de l'agence.
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    const callerEmail = u?.user?.email || "";
    if (!ADMIN_EMAILS.includes(callerEmail)) return json({ error: "forbidden" }, 403);

    const b = await req.json();
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");
    if (!email || password.length < 6) return json({ error: "email + mot de passe (6+) requis" }, 400);

    // Crée (ou récupère) l'utilisateur auth.
    let userId = "";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) {
      // déjà existant : on le retrouve
      const list = await admin.auth.admin.listUsers();
      const found = list.data?.users?.find((x: any) => (x.email || "").toLowerCase() === email);
      if (!found) return json({ error: created.error.message }, 400);
      userId = found.id;
      if (password) await admin.auth.admin.updateUserById(userId, { password });
    } else {
      userId = created.data.user!.id;
    }

    // Insère / met à jour la ligne crm_clients.
    const row = {
      auth_user_id: userId,
      email,
      nom: b.nom || null,
      entreprise: b.entreprise || null,
      type: b.type === "site" ? "site" : "ads",
      telephone_reel: b.telephone_reel || null,
      twilio_number: b.twilio_number || null,
      notify_email: b.notify_email !== false,
      metricool_blog_id: b.metricool_blog_id || null,
      gbp_url: b.gbp_url || null,
      actif: true,
    };
    const up = await admin.from("crm_clients").upsert(row, { onConflict: "auth_user_id" }).select().single();
    if (up.error) return json({ error: up.error.message }, 400);

    return json({ ok: true, client: up.data });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
