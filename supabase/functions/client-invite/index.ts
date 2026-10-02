// Crée un compte espace client (auth user + ligne crm_clients). Réservé à l'équipe.
//
// Le client CHOISIT son mot de passe : on ne lui en attribue jamais un.
// La fonction renvoie un lien d'accès à usage unique que l'agence lui transmet
// (WhatsApp, SMS, de vive voix). Personne chez Potentieel ne connaît le mot de
// passe d'un client — et rien de sensible ne transite par email, ce qui tombe
// bien : le canal d'envoi Gmail est hors service (535 BadCredentials).
//
// Appelée deux fois dans la vie d'un client :
//   • à la création, avec toutes ses informations
//   • plus tard, avec son seul email, pour lui regénérer un lien d'accès
// D'où la règle ci-dessous : on n'écrit QUE les champs réellement transmis,
// sinon le second appel effacerait tout le reste de sa fiche.
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAILS = ["emrick.perilliat2006@gmail.com", "eloisecld73@gmail.com"];
// Page où le client choisit son mot de passe. DOIT figurer dans les
// « Redirect URLs » de Supabase (Authentication > URL Configuration),
// sinon le hub renvoie le client vers le site d'un autre client.
const REDIRECT_TO = Deno.env.get("CLIENT_REDIRECT_URL") || "https://potentieel.fr/reset";

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

    // deno-lint-ignore no-explicit-any
    const b: any = await req.json();
    const email = String(b.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: "Email invalide." }, 400);

    // Crée (ou récupère) l'utilisateur auth. Aucun mot de passe n'est défini :
    // le compte existe mais reste inutilisable tant que le client n'en a pas
    // choisi un via le lien ci-dessous.
    let userId = "";
    let nouveau = false;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) {
      // déjà existant : on le retrouve
      const list = await admin.auth.admin.listUsers();
      const found = list.data?.users?.find((x: any) => (x.email || "").toLowerCase() === email);
      if (!found) return json({ error: created.error.message }, 400);
      userId = found.id;
    } else {
      userId = created.data.user!.id;
      nouveau = true;
    }

    // On n'écrit que ce qui est transmis : un champ absent du corps garde sa
    // valeur actuelle en base (l'upsert ne met à jour que les colonnes fournies).
    const row: Record<string, unknown> = { auth_user_id: userId, email };
    for (const k of ["nom", "entreprise", "telephone_reel", "twilio_number", "metricool_blog_id", "gbp_url"]) {
      if (k in b) row[k] = b[k] || null;
    }
    if ("type" in b) row.type = b.type === "site" ? "site" : "ads";
    if ("notify_email" in b) row.notify_email = b.notify_email !== false;
    // Ne jamais réactiver un client désactivé en lui regénérant un lien.
    if (nouveau) row.actif = true;

    const up = await admin.from("crm_clients").upsert(row, { onConflict: "auth_user_id" }).select().single();
    if (up.error) return json({ error: up.error.message }, 400);

    // Lien d'accès : le client s'identifie une fois et pose son mot de passe.
    // Valable quelques heures ; on peut en regénérer un à tout moment.
    let lien = "";
    let lienErreur = "";
    const gen = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: REDIRECT_TO },
    });
    if (gen.error) lienErreur = gen.error.message;
    else lien = gen.data?.properties?.action_link || "";

    return json({ ok: true, nouveau, client: up.data, lien, lien_erreur: lienErreur });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
