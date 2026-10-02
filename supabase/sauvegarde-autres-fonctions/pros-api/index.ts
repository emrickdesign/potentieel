// pros-api — serveur du CRM Prospects (app séparée, tables pros_*)
//
// Appelée par :
//   • Meta : GET de vérification du webhook + POST « leadgen » signé (X-Hub-Signature-256)
//   • pg_cron chaque minute ({action:"cron"} + x-cron-secret) : leads Meta + agendas des closers
//   • la page publique signer.html (lien du devis) : devis_public, devis_signer
//   • l'agenda d'un closer : GET ?ics=<lead>&s=<signature> (fichier .ics d'un RDV)
//   • l'app (JWT d'un membre de pros_equipe) : status, sync, connect, agendas, rdv_place, ics_lien, push_cle, push_test
//
// Secrets dans Vault (RPC pros_secret_get/set, service_role uniquement) :
//   pros_meta_page_token, pros_meta_app_secret, pros_meta_verify_token, pros_cron_secret,
//   pros_vapid_public, pros_vapid_private (générées au premier besoin, ne quittent jamais le serveur)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import ICAL from "npm:ical.js@2.1.0";
import { mapLead } from "./parse.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const GRAPH = "https://graph.facebook.com/v25.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/pros-api`;
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Noms de pub / campagne : exigent ads_management. Si Meta refuse (#100), on retombe sur le minimum.
const FIELDS_RICH = "id,created_time,ad_id,ad_name,adset_name,campaign_name,form_id,field_data,platform,is_organic";
const FIELDS_MIN = "id,created_time,ad_id,form_id,field_data";
// « offre » porte la garantie « Rentable ou Remboursé » et ses variables : le client doit la lire et la signer
const DEVIS_PUBLIC = "id,lead_id,numero,titre,client,emetteur,lignes,conditions,mentions,offre,tva_taux,total_unique_ht,total_mensuel_ht,valide_jusqu,statut,created_at,envoye_at,vu_at,signe_at,signature";

// deno-lint-ignore no-explicit-any
type Any = any;
type Form = { id: string; name: string; status: string };
type Push = { title: string; body: string; tel?: string; url: string; tag: string };

// ── Petits utilitaires ───────────────────────────────────────
const TRANCHE: Record<string, string> = { lt100k: "< 100 k€", "100k_300k": "100–300 k€", "300k_1m": "300 k–1 M€", gt1m: "> 1 M€" };
const heure = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const prenom = (nom: unknown) => String(nom || "").trim().split(/\s+/)[0] || "";
function telJoli(t: unknown) {
  let d = String(t || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  return /^0\d{9}$/.test(d) ? d.replace(/(\d{2})(?=\d)/g, "$1 ").trim() : String(t || "");
}
const nomClient = (c: Any) => String(c?.entreprise || c?.nom || "le client");
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sha256(txt: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Vault + état de la connexion Meta ────────────────────────
async function secret(name: string): Promise<string | null> {
  const { data, error } = await sb.rpc("pros_secret_get", { p_name: name });
  if (error) throw new Error("vault : " + error.message);
  return (data as string | null) || null;
}
async function setSecret(name: string, value: string) {
  const { error } = await sb.rpc("pros_secret_set", { p_name: name, p_value: value });
  if (error) throw new Error("vault : " + error.message);
}
async function getConfig(): Promise<Any> {
  const { data } = await sb.from("pros_config").select("*").eq("id", 1).maybeSingle();
  return data || {};
}
async function patchConfig(p: Record<string, unknown>) {
  const { error } = await sb.from("pros_config").update(p).eq("id", 1);
  if (error) console.error("pros_config : " + error.message);
}

// ── Notifications push (clés propres au CRM) ─────────────────
async function vapid() {
  let pub = await secret("pros_vapid_public");
  let priv = await secret("pros_vapid_private");
  if (!pub || !priv) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    pub = b64url(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)));
    priv = String((await crypto.subtle.exportKey("jwk", kp.privateKey)).d);
    await setSecret("pros_vapid_public", pub);
    await setSecret("pros_vapid_private", priv);
  }
  return { pub, priv };
}
type Cible = { email?: string; appareil?: string; profil?: string };
async function envoyerPush(p: Push, cible: Cible = {}) {
  const { pub, priv } = await vapid();
  webpush.setVapidDetails("mailto:emrick.perilliat2006@gmail.com", pub, priv);
  let q = sb.from("pros_push").select("*");
  if (cible.email) q = q.eq("email", cible.email);
  if (cible.appareil) q = q.eq("endpoint", cible.appareil); // compte partagé : le test ne sonne que sur ce téléphone
  if (cible.profil) q = q.eq("profil_id", cible.profil);    // le RDV ne sonne que chez le closer concerné
  const { data: subs } = await q;
  let envoyees = 0;
  await Promise.all((subs || []).map(async (s: Any) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(p),
        { TTL: 3600, urgency: "high" },
      );
      envoyees++;
    } catch (err: Any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await sb.from("pros_push").delete().eq("endpoint", s.endpoint); // abonnement expiré
      }
    }
  }));
  return { envoyees, appareils: subs?.length || 0 };
}
function pushNouveauLead(l: Any): Push {
  const lignes = [
    l.telephone ? "📞 " + telJoli(l.telephone) : "",
    l.entreprise || "",
    `Reçu à ${heure(l.created_time)} · touche pour appeler`,
  ].filter(Boolean);
  return {
    title: "🔥 " + (prenom(l.nom) || "Nouveau prospect") + (TRANCHE[l.ca_tranche] ? " · " + TRANCHE[l.ca_tranche] : ""),
    body: lignes.join("\n"),
    tel: l.telephone || "",
    url: "/?lead=" + l.id,
    tag: "lead-" + l.id,
  };
}

// ── Graph API ────────────────────────────────────────────────
class GraphError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}
async function graph(path: string, token: string, params: Record<string, string> = {}, method = "GET") {
  const u = new URL(path.startsWith("http") ? path : `${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (token && !u.searchParams.has("access_token")) u.searchParams.set("access_token", token);
  const r = await fetch(u, { method });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.error) throw new GraphError(d?.error?.message || `Graph HTTP ${r.status}`, d?.error?.code);
  return d;
}
// Suit la pagination (les URL "next" contiennent déjà le jeton)
async function graphAll(path: string, token: string, params: Record<string, string>) {
  const out: Any[] = [];
  let d = await graph(path, token, params);
  out.push(...(d.data || []));
  for (let i = 0; d.paging?.next && i < 60; i++) {
    d = await graph(d.paging.next, "");
    out.push(...(d.data || []));
  }
  return out;
}
async function listForms(pageId: string, token: string): Promise<Form[]> {
  const forms = await graphAll(`${pageId}/leadgen_forms`, token, { fields: "id,name,status", limit: "100" });
  return forms.map((f: Any) => ({ id: String(f.id), name: String(f.name || ""), status: String(f.status || "") }));
}
async function readLead(id: string, token: string) {
  try {
    return await graph(id, token, { fields: FIELDS_RICH });
  } catch (e) {
    if ((e as GraphError).code !== 100) throw e;
    return await graph(id, token, { fields: FIELDS_MIN });
  }
}
async function readFormLeads(formId: string, token: string, since?: number) {
  const params: Record<string, string> = { fields: FIELDS_RICH, limit: "500" };
  if (since) params.filtering = JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]);
  try {
    return await graphAll(`${formId}/leads`, token, params);
  } catch (e) {
    if ((e as GraphError).code !== 100) throw e;
    params.fields = FIELDS_MIN;
    return await graphAll(`${formId}/leads`, token, params);
  }
}
function explain(e: unknown): string {
  const g = e as GraphError;
  const m = String(g?.message || e);
  if (g?.code === 190) return "Jeton Meta expiré ou révoqué : reconnecte Meta dans les réglages.";
  if (g?.code === 10 || g?.code === 200 || /permission/i.test(m)) {
    return `Permission Meta manquante (${m}). Vérifie que le jeton a leads_retrieval et que l'accès aux prospects est ouvert dans Meta Business Suite.`;
  }
  return m;
}

// ── Enregistrement des leads (jamais d'écrasement d'un lead déjà traité) ──
async function saveLeads(leads: Any[], pageId: string | null, formNames: Record<string, string>) {
  if (!leads.length) return 0;
  const rows = leads.map((l) => {
    const r: Any = mapLead(l);
    r.page_id = pageId;
    r.form_name = r.form_id ? formNames[r.form_id] || null : null;
    r.source = "meta";
    return r;
  });
  const nouveaux: Any[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await sb.from("pros_leads")
      .upsert(rows.slice(i, i + 200), { onConflict: "meta_lead_id", ignoreDuplicates: true })
      .select("id,nom,telephone,entreprise,ca_tranche,created_time");
    if (error) throw new Error("base : " + error.message);
    nouveaux.push(...(data || []));
  }
  // Notif seulement pour les leads frais (pas pour l'import de l'historique)
  const frais = nouveaux.filter((l) => Date.now() - new Date(l.created_time).getTime() < 30 * 60_000);
  for (const l of frais) {
    try { await envoyerPush(pushNouveauLead(l)); } catch (e) { console.error("push : " + (e as Error).message); }
  }
  return nouveaux.length;
}

// ── Synchro (cron, bouton « Synchroniser », import initial) ──
async function syncAll(full: boolean) {
  const token = await secret("pros_meta_page_token");
  const cfg = await getConfig();
  if (!token || !cfg.page_id) return { ok: true, skipped: "Meta non connecté" };
  try {
    let forms: Form[] = Array.isArray(cfg.forms) ? cfg.forms : [];
    const stale = !cfg.forms_refreshed_at || Date.now() - new Date(cfg.forms_refreshed_at).getTime() > 30 * 60_000;
    if (full || stale || !forms.length) {
      forms = await listForms(cfg.page_id, token);
      await patchConfig({ forms, forms_refreshed_at: new Date().toISOString() });
    }
    // Incrémental : depuis le dernier lead connu, avec 1 h de marge (les webhooks arrivent parfois en retard)
    let since: number | undefined;
    if (!full) {
      const { data: last } = await sb.from("pros_leads").select("created_time").eq("source", "meta")
        .order("created_time", { ascending: false }).limit(1);
      if (last?.length) since = Math.floor(new Date(last[0].created_time).getTime() / 1000) - 3600;
    }
    const targets = since ? forms.filter((f) => !["ARCHIVED", "DELETED", "DRAFT"].includes(f.status)) : forms;
    const names = Object.fromEntries(forms.map((f) => [f.id, f.name]));
    let inserted = 0, seen = 0;
    for (const f of targets) {
      const leads = await readFormLeads(f.id, token, since);
      seen += leads.length;
      inserted += await saveLeads(leads, cfg.page_id, names);
    }
    const s = (n: number) => (n > 1 ? "s" : "");
    const msg = `${inserted} nouveau${inserted > 1 ? "x" : ""} · ${seen} lu${s(seen)} · ${targets.length} formulaire${s(targets.length)}`;
    await patchConfig({ last_sync_at: new Date().toISOString(), last_sync_ok: true, last_sync_msg: msg });
    return { ok: true, inserted, seen, forms: targets.length, msg };
  } catch (e) {
    const msg = explain(e);
    const patch: Record<string, unknown> = { last_sync_at: new Date().toISOString(), last_sync_ok: false, last_sync_msg: msg };
    // Jeton expiré : plus aucun lead n'arrive. On prévient sur les téléphones, une fois par jour.
    if ((e as GraphError)?.code === 190) {
      const cfgNow = await getConfig();
      const depuis = cfgNow.alerte_token_at ? Date.now() - new Date(cfgNow.alerte_token_at).getTime() : Infinity;
      if (depuis > 20 * 3600_000) {
        patch.alerte_token_at = new Date().toISOString();
        try {
          await envoyerPush({
            title: "⚠️ Connexion Meta expirée",
            body: "Les nouveaux leads n'arrivent plus.\nRéglages → Reconnecter Meta.",
            url: "/?reglages=1",
            tag: "meta-token",
          });
        } catch { /* la synchro reste prioritaire */ }
      }
    }
    await patchConfig(patch);
    return { ok: false, error: msg };
  }
}

// ── Agendas des closers (lien iCal privé de Google Agenda, lecture seule) ──
const JOURS_AGENDA = 21;
async function lireAgenda(url: string) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`agenda inaccessible (HTTP ${r.status})`);
  const texte = await r.text();
  if (!/BEGIN:VCALENDAR/i.test(texte)) throw new Error("ce lien ne renvoie pas un agenda iCal");
  const comp = new ICAL.Component(ICAL.parse(texte));
  const debutFenetre = ICAL.Time.fromJSDate(new Date(Date.now() - 864e5), true);
  const finFenetre = ICAL.Time.fromJSDate(new Date(Date.now() + JOURS_AGENDA * 864e5), true);
  const out: Any[] = [];
  for (const sous of comp.getAllSubcomponents("vevent")) {
    if (out.length > 800) break;
    // Un créneau « disponible » ou un événement annulé ne bloque pas
    if (String(sous.getFirstPropertyValue("transp") || "").toUpperCase() === "TRANSPARENT") continue;
    if (String(sous.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED") continue;
    let ev: Any;
    try { ev = new ICAL.Event(sous); } catch { continue; }
    const garder = (debut: Any, fin: Any) => {
      if (!debut || !fin) return;
      if (fin.compare(debutFenetre) < 0 || debut.compare(finFenetre) > 0) return;
      out.push({
        debut: debut.toJSDate().toISOString(),
        fin: fin.toJSDate().toISOString(),
        titre: String(ev.summary || "Occupé").slice(0, 120),
        uid: String(ev.uid || "").slice(0, 200),
      });
    };
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator();
        for (let t = it.next(), n = 0; t && n < 60; t = it.next(), n++) {
          if (t.compare(finFenetre) > 0) break;
          const occ = ev.getOccurrenceDetails(t);
          garder(occ.startDate, occ.endDate);
        }
      } else {
        garder(ev.startDate, ev.endDate);
      }
    } catch { /* événement illisible : on passe */ }
  }
  return out;
}
async function syncAgendas() {
  const { data: profils } = await sb.from("pros_profils").select("id,nom,ical_url").not("ical_url", "is", null);
  const messages: string[] = [];
  for (const p of profils || []) {
    const url = String(p.ical_url || "").trim().replace(/^webcal:/i, "https:");
    if (!/^https?:\/\//.test(url)) continue;
    try {
      const evs = await lireAgenda(url);
      await sb.from("pros_occupations").delete().eq("profil_id", p.id);
      if (evs.length) {
        await sb.from("pros_occupations").insert(evs.map((e: Any) => ({ ...e, profil_id: p.id })));
      }
      messages.push(`${p.nom} : ${evs.length} créneau${evs.length > 1 ? "x" : ""}`);
    } catch (e) {
      messages.push(`${p.nom} : ${(e as Error).message}`);
    }
  }
  const msg = messages.join(" · ") || "aucun agenda relié";
  await patchConfig({ agendas_sync_at: new Date().toISOString(), agendas_sync_msg: msg });
  return { ok: true, msg };
}

// ── Webhook leadgen ──────────────────────────────────────────
async function validSig(raw: string, header: string, appSecret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const expected = "sha256=" + [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
async function processLeadgen(items: { id: string; page: string }[]) {
  try {
    const token = await secret("pros_meta_page_token");
    if (!token) return;
    const cfg = await getConfig();
    let forms: Form[] = Array.isArray(cfg.forms) ? cfg.forms : [];
    for (const it of items) {
      try {
        const lead = await readLead(it.id, token);
        // Formulaire créé depuis la dernière synchro : on rafraîchit la liste pour avoir son nom
        if (lead.form_id && !forms.some((f) => f.id === String(lead.form_id)) && cfg.page_id) {
          forms = await listForms(cfg.page_id, token);
          await patchConfig({ forms, forms_refreshed_at: new Date().toISOString() });
        }
        await saveLeads([lead], it.page || cfg.page_id || null, Object.fromEntries(forms.map((f) => [f.id, f.name])));
      } catch (e) {
        console.error(`leadgen ${it.id} : ${explain(e)}`);
      }
    }
    await patchConfig({ last_webhook_at: new Date().toISOString() });
  } catch (e) {
    console.error("webhook : " + explain(e));
  }
}
async function onWebhook(raw: string, sig: string | null, body: Any) {
  const appSecret = await secret("pros_meta_app_secret");
  if (appSecret && !(sig && (await validSig(raw, sig, appSecret)))) {
    return json({ ok: false, error: "signature invalide" }, 401);
  }
  const items: { id: string; page: string }[] = [];
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch?.field === "leadgen" && ch.value?.leadgen_id) {
        items.push({ id: String(ch.value.leadgen_id), page: String(ch.value.page_id || entry.id || "") });
      }
    }
  }
  // Réponse immédiate à Meta ; la lecture du lead continue en arrière-plan
  if (items.length) EdgeRuntime.waitUntil(processLeadgen(items));
  return json({ ok: true, received: items.length });
}

// ── Devis : page publique de consultation et de signature ────
const devisVisible = (d: Any) => {
  const { id: _id, lead_id: _lead, vu_at: _vu, ...reste } = d;
  if (reste.signature) {
    const { user_agent: _ua, ...sig } = reste.signature;
    reste.signature = sig;
  }
  return reste;
};
async function devisParToken(token: unknown) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ""))) return null;
  const { data } = await sb.from("pros_devis").select(DEVIS_PUBLIC).eq("token", String(token)).maybeSingle();
  return data && !["brouillon", "annule"].includes(data.statut) ? data : null;
}
async function devisPublic(token: unknown) {
  const d = await devisParToken(token);
  if (!d) return { ok: false, error: "Ce devis n'est pas disponible. Demandez un nouveau lien à votre interlocuteur." };
  if (d.statut === "envoye") {
    // Première ouverture par le client : c'est le bon moment pour l'appeler
    const maintenant = new Date().toISOString();
    await sb.from("pros_devis").update({ statut: "vu", vu_at: maintenant }).eq("id", d.id).eq("statut", "envoye");
    d.statut = "vu";
    EdgeRuntime.waitUntil(envoyerPush({
      title: `👀 Devis ouvert · ${nomClient(d.client)}`,
      body: `${d.numero} vient d'être ouvert par le client.\nC'est le bon moment pour l'appeler.`,
      tel: d.client?.telephone || "",
      url: "/?devis=" + d.id,
      tag: "devis-vu-" + d.id,
    }).catch(() => {}));
  }
  return { ok: true, devis: devisVisible(d) };
}
async function devisSigner(b: Any, req: Request) {
  const nom = String(b.nom || "").trim();
  const fonction = String(b.fonction || "").trim().slice(0, 120);
  const image = String(b.signature || "");
  if (nom.length < 2 || nom.length > 120) return { ok: false, error: "Indiquez votre nom et votre prénom." };
  if (b.accepte !== true) return { ok: false, error: "Cochez la case « Bon pour accord » pour signer." };
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 400_000) {
    return { ok: false, error: "Signez dans le cadre avant de valider." };
  }
  const d = await devisParToken(b.token);
  if (!d) return { ok: false, error: "Ce devis n'est pas disponible." };
  if (d.statut === "signe") return { ok: false, error: "Ce devis est déjà signé.", devis: devisVisible(d) };
  if (!["envoye", "vu"].includes(d.statut)) return { ok: false, error: "Ce devis ne peut plus être signé." };
  const aujourdhui = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ
  if (d.valide_jusqu && d.valide_jusqu < aujourdhui) {
    return { ok: false, error: "Ce devis a expiré. Demandez une nouvelle version à votre interlocuteur." };
  }

  const signeAt = new Date().toISOString();
  // Empreinte du contenu signé : prouve que le devis n'a pas changé après signature
  const empreinte = await sha256(JSON.stringify({
    numero: d.numero, client: d.client, emetteur: d.emetteur, lignes: d.lignes, conditions: d.conditions,
    mentions: d.mentions, offre: d.offre, tva_taux: d.tva_taux, total_unique_ht: d.total_unique_ht,
    total_mensuel_ht: d.total_mensuel_ht, valide_jusqu: d.valide_jusqu,
  }));
  const signature = {
    nom, fonction, image, signe_at: signeAt, empreinte,
    ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
  };
  const { data: maj, error } = await sb.from("pros_devis")
    .update({ statut: "signe", signe_at: signeAt, signature })
    .eq("id", d.id).in("statut", ["envoye", "vu"])
    .select(DEVIS_PUBLIC);
  if (error) return { ok: false, error: "Signature impossible pour le moment, réessayez." };
  if (!maj?.length) return { ok: false, error: "Ce devis est déjà signé." };

  // Devis signé : le prospect reste (ou passe) en « Closing positif » ; « Collecté » se marque à l'encaissement
  if (d.lead_id) {
    const { data: l } = await sb.from("pros_leads").select("etape,closing_positif_at,historique").eq("id", d.lead_id).maybeSingle();
    if (l) {
      const patch: Record<string, unknown> = {
        contracte_at: signeAt,
        historique: [...(l.historique || []), { at: signeAt, type: "etape", detail: `Devis ${d.numero} signé par ${nom}`, par: "client" }],
      };
      if (!["closing_positif", "collecte"].includes(l.etape)) patch.etape = "closing_positif";
      if (!l.closing_positif_at) patch.closing_positif_at = signeAt;
      await sb.from("pros_leads").update(patch).eq("id", d.lead_id);
    }
  }
  EdgeRuntime.waitUntil(envoyerPush({
    title: `✍️ Devis signé · ${nomClient(d.client)}`,
    body: `${d.numero} signé par ${nom} à ${heure(signeAt)}.`,
    url: "/?devis=" + d.id,
    tag: "devis-signe-" + d.id,
  }).catch(() => {}));
  return { ok: true, devis: devisVisible(maj[0]) };
}

// ── Fichier .ics d'un RDV de closing (lien signé : l'app Agenda n'a pas de JWT) ──
async function signer(texte: string) {
  const cle = (await secret("pros_cron_secret")) || "";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(cle), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texte)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}
const icalDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icalTexte = (t: unknown) =>
  String(t ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
async function ficheIcs(leadId: string, sig: string) {
  if (sig !== (await signer(leadId))) return new Response("lien invalide", { status: 403 });
  const { data: l } = await sb.from("pros_leads")
    .select("id,nom,entreprise,telephone,email,ca_reponse,notes,closing_at,closer_profil_id").eq("id", leadId).maybeSingle();
  if (!l?.closing_at) return new Response("rendez-vous introuvable", { status: 404 });
  const { data: closer } = l.closer_profil_id
    ? await sb.from("pros_profils").select("nom,agenda,emetteur").eq("id", l.closer_profil_id).maybeSingle()
    : { data: null };
  const minutes = Number(closer?.agenda?.duree) || 45;
  const fin = new Date(new Date(l.closing_at).getTime() + minutes * 60_000).toISOString();
  const titre = `Closing · ${l.nom || "prospect"}${l.entreprise ? " (" + l.entreprise + ")" : ""}`;
  const details = [
    l.telephone ? `Téléphone : ${telJoli(l.telephone)}` : "",
    l.email ? `Email : ${l.email}` : "",
    l.ca_reponse ? `Chiffre d'affaires annoncé : ${l.ca_reponse}` : "",
    l.notes ? `Notes : ${l.notes}` : "",
    closer?.nom ? `Closer : ${closer.nom}` : "",
    `Fiche : https://crm-prospects-ten.vercel.app/?lead=${l.id}`,
  ].filter(Boolean).join("\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CRM Prospects//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:closing-${l.id}@crm-prospects`,
    `DTSTAMP:${icalDate(new Date().toISOString())}`,
    `DTSTART:${icalDate(l.closing_at)}`,
    `DTEND:${icalDate(fin)}`,
    `SUMMARY:${icalTexte(titre)}`,
    `DESCRIPTION:${icalTexte(details)}`,
    l.telephone ? `LOCATION:${icalTexte(telJoli(l.telephone))}` : "",
    "BEGIN:VALARM", "TRIGGER:-PT10M", "ACTION:DISPLAY", `DESCRIPTION:${icalTexte(titre)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return new Response(ics, {
    headers: { ...CORS, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="closing.ics"` },
  });
}

// ── Actions de l'app (équipe connectée) ──────────────────────
async function equipe(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return null;
  const { data: row } = await sb.from("pros_equipe").select("email").eq("email", email).maybeSingle();
  return row ? email : null;
}
async function status() {
  const cfg = await getConfig();
  const token = await secret("pros_meta_page_token");
  return {
    ok: true,
    connected: !!(token && cfg.page_id),
    page_id: cfg.page_id || null,
    page_name: cfg.page_name || null,
    webhook_subscribed: !!cfg.webhook_subscribed,
    token_expires_at: cfg.token_expires_at || null,
    token_longue_duree: cfg.token_longue_duree ?? null,
    forms: (cfg.forms || []).map((f: Form) => ({ name: f.name, status: f.status })),
    last_sync_at: cfg.last_sync_at || null,
    last_sync_ok: cfg.last_sync_ok ?? null,
    last_sync_msg: cfg.last_sync_msg || null,
    last_webhook_at: cfg.last_webhook_at || null,
    agendas_sync_at: cfg.agendas_sync_at || null,
    agendas_sync_msg: cfg.agendas_sync_msg || null,
    callback_url: CALLBACK_URL,
    verify_token: await secret("pros_meta_verify_token"),
  };
}
async function connect(b: Any) {
  const appId = String(b.app_id || "").trim();
  const appSecret = String(b.app_secret || "").trim();
  let userToken = String(b.token || "").trim();
  if (!appId || !appSecret || !userToken) {
    return { ok: false, error: "L'App ID, la clé secrète et le jeton sont obligatoires." };
  }
  // 1) Jeton longue durée : les jetons de Page qui en découlent n'expirent jamais
  let longueDuree = false;
  try {
    const ex = await graph("oauth/access_token", "", {
      grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: userToken,
    });
    if (ex.access_token) { userToken = ex.access_token; longueDuree = true; }
  } catch (e) {
    const m = String((e as Error).message || "");
    if (/secret|client_id|application/i.test(m)) return { ok: false, error: "Meta refuse l'App ID ou la clé secrète : " + m };
    // Sinon (jeton de Page collé directement…) : on continue avec le jeton tel quel
  }
  // 2) Pages accessibles avec ce jeton
  let pages: Any[] = [];
  try {
    pages = await graphAll("me/accounts", userToken, { fields: "id,name,access_token", limit: "100" });
  } catch { /* jeton de Page : pas de /me/accounts */ }
  if (!pages.length) {
    try {
      const me = await graph("me", userToken, { fields: "id,name" });
      pages = [{ id: me.id, name: me.name, access_token: userToken }];
    } catch (e) {
      return { ok: false, error: "Jeton refusé par Meta : " + explain(e) };
    }
  }
  const page = b.page_id ? pages.find((p) => String(p.id) === String(b.page_id)) : pages.length === 1 ? pages[0] : null;
  if (!page) return { ok: true, choose: pages.map((p) => ({ id: String(p.id), name: String(p.name || p.id) })) };
  const pageId = String(page.id);
  const pageToken = String(page.access_token);
  // 3) Accès aux formulaires (échoue si leads_retrieval / pages_manage_ads manquent)
  let forms: Form[];
  try {
    forms = await listForms(pageId, pageToken);
  } catch (e) {
    return { ok: false, error: `Impossible de lire les formulaires de « ${page.name} » : ${explain(e)}` };
  }
  // 4) Expiration du jeton (facultatif)
  let expiresAt: string | null = null;
  try {
    const dbg = await graph("debug_token", `${appId}|${appSecret}`, { input_token: pageToken });
    const x = Number(dbg?.data?.expires_at || 0);
    expiresAt = x > 0 ? new Date(x * 1000).toISOString() : null;
  } catch { /* non bloquant */ }
  await setSecret("pros_meta_page_token", pageToken);
  await setSecret("pros_meta_app_secret", appSecret);
  // 5) Abonne l'app aux leads de la Page (webhook temps réel)
  let subscribed = false;
  let subscribeError: string | null = null;
  try {
    await graph(`${pageId}/subscribed_apps`, pageToken, { subscribed_fields: "leadgen" }, "POST");
    subscribed = true;
  } catch (e) {
    subscribeError = explain(e);
  }
  const now = new Date().toISOString();
  await patchConfig({
    page_id: pageId, page_name: String(page.name || ""), app_id: appId, connected_at: now,
    webhook_subscribed: subscribed, token_expires_at: expiresAt, token_longue_duree: longueDuree && !expiresAt,
    alerte_token_at: null, forms, forms_refreshed_at: now,
  });
  // 6) Import de tout l'historique disponible (sans notif)
  const sync = await syncAll(true);
  return {
    ok: true, page: { id: pageId, name: page.name }, forms: forms.length, subscribed,
    subscribe_error: subscribeError, sync,
    // Jeton avec une date de fin : il faudra reconnecter Meta. On le dit tout de suite.
    avertissement: expiresAt
      ? `Ce jeton expire le ${new Date(expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" })}. Pour un accès qui ne s'arrête plus, recommence avec un jeton d'utilisateur (Graph API Explorer) et la clé secrète de l'app.`
      : longueDuree ? null : "Jeton accepté, mais Meta n'a pas pu l'échanger en jeton longue durée : il peut expirer. Si les leads s'arrêtent, reconnecte Meta.",
  };
}

// ── Routage ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  try {
    // Vérification du webhook par Meta
    if (req.method === "GET") {
      if (url.searchParams.get("hub.mode") === "subscribe") {
        const ok = url.searchParams.get("hub.verify_token") === (await secret("pros_meta_verify_token"));
        return ok
          ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 })
          : new Response("verify token invalide", { status: 403 });
      }
      const ics = url.searchParams.get("ics");
      if (ics) return await ficheIcs(ics, url.searchParams.get("s") || "");
      return new Response("pros-api", { status: 200 });
    }
    if (req.method !== "POST") return json({ ok: false }, 405);

    const raw = await req.text();
    let body: Any = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json({ ok: false, error: "JSON invalide" }, 400);
    }

    const sig = req.headers.get("x-hub-signature-256");
    if (sig || body.object === "page") return await onWebhook(raw, sig, body);

    if (body.action === "cron") {
      if (req.headers.get("x-cron-secret") !== (await secret("pros_cron_secret"))) return json({ ok: false }, 401);
      // Les agendas des closers sont relus toutes les 10 minutes, en arrière-plan
      const cfgCron = await getConfig();
      if (!cfgCron.agendas_sync_at || Date.now() - new Date(cfgCron.agendas_sync_at).getTime() > 10 * 60_000) {
        EdgeRuntime.waitUntil(syncAgendas().catch((e) => console.error("agendas : " + (e as Error).message)));
      }
      return json(await syncAll(false));
    }

    // Page publique du devis (le lien secret fait office d'accès)
    if (body.action === "devis_public") return json(await devisPublic(body.token));
    if (body.action === "devis_signer") return json(await devisSigner(body, req));

    const email = await equipe(req);
    if (!email) return json({ ok: false, error: "Non autorisé" }, 401);
    switch (body.action) {
      case "status":
        return json(await status());
      case "sync":
        return json(await syncAll(!!body.full));
      case "connect":
        return json(await connect(body));
      case "agendas":
        return json(await syncAgendas());
      case "rdv_place": {
        // Héloïse vient de placer un closing : le closer concerné est prévenu sur son téléphone
        const { data: l } = await sb.from("pros_leads")
          .select("id,nom,entreprise,telephone,closing_at,closer_profil_id").eq("id", String(body.lead_id || "")).maybeSingle();
        if (!l?.closing_at || !l.closer_profil_id) return json({ ok: false, error: "RDV incomplet" }, 400);
        const quand = new Date(l.closing_at).toLocaleString("fr-FR",
          { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
        const envoi = await envoyerPush({
          title: `📅 Closing placé · ${prenom(l.nom) || "prospect"}`,
          body: `${quand}\n${l.entreprise || ""}${l.telephone ? (l.entreprise ? " · " : "") + telJoli(l.telephone) : ""}`.trim(),
          tel: l.telephone || "",
          url: "/?lead=" + l.id,
          tag: "rdv-" + l.id,
        }, { profil: l.closer_profil_id });
        return json({ ok: true, ...envoi, ics: `${CALLBACK_URL}?ics=${l.id}&s=${await signer(l.id)}` });
      }
      case "ics_lien":
        return json({ ok: true, lien: `${CALLBACK_URL}?ics=${String(body.lead_id || "")}&s=${await signer(String(body.lead_id || ""))}` });
      case "push_cle":
        return json({ ok: true, cle: (await vapid()).pub });
      case "push_test":
        return json({
          ok: true,
          ...(await envoyerPush({
            title: "✅ Notifications actives",
            body: "Tu recevras une alerte à chaque nouveau prospect.",
            url: "/",
            tag: "test",
          }, { email, appareil: typeof body.endpoint === "string" ? body.endpoint : undefined })),
        });
      default:
        return json({ ok: false, error: "Action inconnue" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: explain(e) }, 500);
  }
});
