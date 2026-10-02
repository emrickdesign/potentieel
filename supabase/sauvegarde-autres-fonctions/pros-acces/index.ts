// pros-acces — accès de l'équipe du CRM Prospects (un compte par personne)
//
//   • inviter (JWT d'Emrick ou Tom) : crée un lien d'accès à usage unique pour un profil
//   • invitation_info (public, avec le lien) : à qui est destiné le lien
//   • accepter_invitation (public, avec le lien) : la personne choisit son email et son mot de passe
//
// Personne d'autre que la personne invitée ne connaît son mot de passe.
import { createClient } from "npm:@supabase/supabase-js@2";

const APP_URL = "https://crm-prospects-ten.vercel.app";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// deno-lint-ignore no-explicit-any
type Any = any;

async function sha256(txt: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const LIEN_MORT = "Ce lien d'accès n'est plus valable. Demande-en un nouveau à Emrick.";

async function membre(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return null;
  const { data: row } = await sb.from("pros_equipe").select("email").eq("email", email).maybeSingle();
  return row ? email : null;
}

async function lireInvitation(token: unknown) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ""))) return null;
  const { data: inv } = await sb.from("pros_invitations").select("id,profil_id,expire_at,utilise_at")
    .eq("token_hash", await sha256(String(token))).maybeSingle();
  if (!inv || inv.utilise_at || new Date(inv.expire_at).getTime() < Date.now()) return null;
  const { data: profil } = await sb.from("pros_profils").select("id,nom,email,role").eq("id", inv.profil_id).maybeSingle();
  return profil ? { inv, profil } : null;
}

async function inviter(email: string, profilId: string) {
  const { data: moi } = await sb.from("pros_profils").select("role").ilike("email", email).maybeSingle();
  if (moi?.role === "setteuse") return json({ ok: false, error: "Seuls Emrick et Tom peuvent créer des accès." }, 403);
  const { data: p } = await sb.from("pros_profils").select("id,nom").eq("id", profilId).maybeSingle();
  if (!p) return json({ ok: false, error: "Profil introuvable" }, 404);
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await sb.from("pros_invitations").insert({ profil_id: p.id, token_hash: await sha256(token), cree_par: email });
  if (error) return json({ ok: false, error: "Invitation impossible : " + error.message }, 500);
  return json({ ok: true, nom: p.nom, lien: `${APP_URL}/?invitation=${token}` });
}

async function accepter(b: Any) {
  const r = await lireInvitation(b.token);
  if (!r) return { ok: false, error: LIEN_MORT };
  const email = String(b.email || "").trim().toLowerCase();
  const mdp = String(b.mot_de_passe || "");
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: "Indique ton adresse email." };
  if (mdp.length < 8) return { ok: false, error: "Choisis un mot de passe d'au moins 8 caractères." };
  const { data: existant } = await sb.rpc("pros_user_id_par_email", { p_email: email });
  if (existant) {
    // Compte déjà là : le lien ne sert qu'à redéfinir le mot de passe de la personne invitée
    if (String(r.profil.email || "").toLowerCase() !== email) {
      return { ok: false, error: "Cet email a déjà un compte : connecte-toi directement avec, ou utilise un autre email." };
    }
    const { error } = await sb.auth.admin.updateUserById(String(existant), { password: mdp, email_confirm: true });
    if (error) return { ok: false, error: "Mot de passe refusé : " + error.message };
  } else {
    const { error } = await sb.auth.admin.createUser({ email, password: mdp, email_confirm: true });
    if (error) return { ok: false, error: "Création du compte impossible : " + error.message };
  }
  await sb.from("pros_equipe").upsert({ email, nom: r.profil.nom }, { onConflict: "email" });
  await sb.from("pros_profils").update({ email }).eq("id", r.profil.id);
  await sb.from("pros_invitations").update({ utilise_at: new Date().toISOString() }).eq("id", r.inv.id);
  return { ok: true, email, nom: r.profil.nom };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);
  let body: Any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSON invalide" }, 400); }
  try {
    if (body.action === "invitation_info") {
      const r = await lireInvitation(body.token);
      return json(r ? { ok: true, nom: r.profil.nom, email: r.profil.email || "" } : { ok: false, error: LIEN_MORT });
    }
    if (body.action === "accepter_invitation") return json(await accepter(body));
    if (body.action === "inviter") {
      const email = await membre(req);
      if (!email) return json({ ok: false, error: "Non autorisé" }, 401);
      return await inviter(email, String(body.profil_id || ""));
    }
    return json({ ok: false, error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
