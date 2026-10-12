import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { buildEInvoice, ENTITES, fmtDateFr, type FactureRow } from "./model.ts";
import { toCII } from "./cii.ts";
import { renderFacturePdf } from "./pdf.ts";

/*
 * factures-envoi — facturation automatique Factur-X du CRM Potentieel.
 *
 * Table crm_factures : une ligne par paiement reçu (Stripe via stripe-webhook, virement
 * coché dans la fiche client). Une facture « brouillon » attend la validation de
 * l'équipe ; quand le réglage facturation_auto vaut true, elle est émise dès sa création.
 *
 * Appels :
 *  - cron quotidien (en-tête x-cron-secret) : génère le PDF/A-3 Factur-X de chaque
 *    facture « a_envoyer » (ou « erreur », 5 tentatives max), l'archive dans le bucket
 *    privé « factures », l'envoie au client (copie à l'agence) et la marque « envoyee ».
 *    En cas d'échec, une alerte part à l'équipe.
 *  - équipe (JWT, table potentieel_equipe) :
 *      { action: 'apercu',  id }  → PDF (base64) ; « BROUILLON » à la place du numéro si non émise
 *      { action: 'envoyer', id }  → émet si besoin (numéro définitif) puis envoie tout de suite
 *      { action: 'pdf',     id }  → URL signée du PDF archivé
 *
 * Email : Resend (domaine potentieel.fr) si la clé crm_resend_api_key existe, sinon Gmail.
 * Aucun secret en dur : env (MAJUSCULES) ou Vault via crm_secret_get.
 */

type AnyObj = Record<string, any>;
const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

const AGENCE_EMAIL = "potentieel.web@gmail.com";
const FROM_RESEND = "Potentieel <factures@potentieel.fr>";
const MAX_TENTATIVES = 5;

const _sec: Record<string, string | null> = {};
async function secretOpt(name: string): Promise<string | null> {
  const env = Deno.env.get(name.toUpperCase());
  if (env) return env;
  if (name in _sec) return _sec[name];
  const { data } = await admin.rpc("crm_secret_get", { p_name: name });
  return (_sec[name] = data ? String(data) : null);
}
async function secret(name: string): Promise<string> {
  const v = await secretOpt(name);
  if (!v) throw new Error(`Secret ${name} introuvable`);
  return v;
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const eur = (n: number) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, " ") + " €";
const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

// ── Envoi d'email (Resend si configuré, sinon Gmail) ──
async function sendMail(opts: { to: string[]; cc?: string[]; subject: string; text: string; html?: string; pdf?: { name: string; bytes: Uint8Array } }) {
  const resendKey = await secretOpt("crm_resend_api_key");
  if (resendKey) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_RESEND, to: opts.to, cc: opts.cc, reply_to: AGENCE_EMAIL,
        subject: opts.subject, text: opts.text, html: opts.html,
        attachments: opts.pdf ? [{ filename: opts.pdf.name, content: encodeBase64(opts.pdf.bytes) }] : undefined,
      }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status} : ${(await r.text()).slice(0, 200)}`);
    return;
  }
  const client = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true,
    auth: { username: AGENCE_EMAIL, password: await secret("crm_gmail_app_password") } } });
  try {
    await client.send({
      from: `Potentieel <${AGENCE_EMAIL}>`, to: opts.to, cc: opts.cc, replyTo: AGENCE_EMAIL,
      subject: opts.subject, content: opts.text, html: opts.html,
      attachments: opts.pdf ? [{ filename: opts.pdf.name, content: encodeBase64(opts.pdf.bytes), encoding: "base64", contentType: "application/pdf" }] : undefined,
    });
  } finally {
    await client.close();
  }
}

// ── Génération ──
async function loadFacture(id: string): Promise<AnyObj> {
  const { data, error } = await admin.from("crm_factures").select("*").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Facture introuvable");
  if (data.avoir_de) {
    const { data: o } = await admin.from("crm_factures").select("numero,date_emission").eq("id", data.avoir_de).maybeSingle();
    data.avoir_de_numero = o?.numero ?? null;
    data.avoir_de_date = o?.date_emission ?? null;
  }
  return data;
}

async function generate(f: AnyObj, numero: string, issueDate: string) {
  const built = buildEInvoice(f as FactureRow, numero, issueDate);
  const xml = toCII(built.model);
  const pdf = await renderFacturePdf(f as FactureRow, built, xml, numero, issueDate);
  return { pdf, xml, warnings: built.warnings };
}

function emailBody(f: AnyObj) {
  const ent = ENTITES[f.entite] || ENTITES.emrick;
  const nom = String(f.client?.nom || "").trim();
  const isAvoir = f.type === "avoir";
  const paid = !!f.date_paiement && !isAvoir;
  const quoi = isAvoir ? "votre avoir" : "votre facture";
  const intro = nom ? `Bonjour ${nom},` : "Bonjour,";
  const lignePaiement = paid
    ? `Elle a bien été réglée le ${fmtDateFr(f.date_paiement)} : aucune action n'est requise de votre part.`
    : isAvoir ? "" : "Elle est payable à réception.";
  const text =
`${intro}

Veuillez trouver ci-joint ${quoi} ${f.numero} d'un montant de ${eur(Number(f.total))}.
${lignePaiement}

Le PDF joint est une facture électronique Factur-X : vous pouvez la transmettre telle quelle à votre comptable.

Merci de votre confiance,

${ent.prenom} — Potentieel
${AGENCE_EMAIL} · potentieel.fr`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111;max-width:560px">
<p>${intro.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>
<p>Veuillez trouver ci-joint ${quoi} <b>${f.numero}</b> d'un montant de <b>${eur(Number(f.total))}</b>.<br>${lignePaiement}</p>
<p style="color:#555;font-size:13.5px">Le PDF joint est une facture électronique Factur-X : vous pouvez la transmettre telle quelle à votre comptable.</p>
<p>Merci de votre confiance,<br><br>${ent.prenom} — <b>Potentieel</b><br><a href="https://potentieel.fr" style="color:#e0703f">potentieel.fr</a></p></div>`;
  const subject = `${isAvoir ? "Votre avoir" : "Votre facture"} ${f.numero} — Potentieel`;
  return { text, html, subject };
}

// Génère (une seule fois), archive et envoie une facture émise.
async function envoyer(id: string): Promise<string> {
  const f = await loadFacture(id);
  if (!f.numero) throw new Error("Facture non émise");
  const email = String(f.client?.email || "").trim();
  try {
    let bytes: Uint8Array;
    const path = f.pdf_path || `${f.entite}/${f.annee}/${f.numero}.pdf`;
    if (f.pdf_path) {
      // Document déjà émis : on renvoie exactement le même fichier.
      const { data, error } = await admin.storage.from("factures").download(f.pdf_path);
      if (error || !data) throw new Error("PDF archivé illisible : " + (error?.message || ""));
      bytes = new Uint8Array(await data.arrayBuffer());
    } else {
      const g = await generate(f, f.numero, f.date_emission || parisToday());
      bytes = g.pdf;
      const up = await admin.storage.from("factures").upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (up.error) throw new Error("Archivage du PDF : " + up.error.message);
      await admin.from("crm_factures").update({ pdf_path: path }).eq("id", id);
    }
    if (!email) throw new Error("Email du client manquant : complète la fiche client puis renvoie.");
    const mail = emailBody(f);
    await sendMail({ to: [email], cc: [AGENCE_EMAIL], subject: mail.subject, text: mail.text, html: mail.html, pdf: { name: `${f.numero}.pdf`, bytes } });
    await admin.from("crm_factures").update({
      statut: "envoyee", envoyee_le: new Date().toISOString(), envoi_erreur: null,
      envoi_tentatives: (f.envoi_tentatives || 0) + 1,
    }).eq("id", id);
    return "envoyee";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("crm_factures").update({
      statut: "erreur", envoi_erreur: msg.slice(0, 500), envoi_tentatives: (f.envoi_tentatives || 0) + 1,
    }).eq("id", id);
    throw new Error(`${f.numero} : ${msg}`);
  }
}

async function alerteEquipe(lignes: string[]) {
  const { data: team } = await admin.from("potentieel_equipe").select("email");
  const to = (team ?? []).map((t: AnyObj) => String(t.email)).filter(Boolean);
  if (!to.length) return;
  await sendMail({
    to,
    subject: `⚠ ${lignes.length} facture(s) non envoyée(s)`,
    text: `Bonjour,\n\nL'envoi automatique des factures a échoué pour :\n\n${lignes.map((l) => "• " + l).join("\n")}\n\nCorrige la fiche si besoin, puis clique « Renvoyer » dans CRM → Facturation.\n\n— Facturation automatique Potentieel`,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Cron quotidien ──
  const cron = req.headers.get("x-cron-secret");
  if (cron !== null) {
    const expected = await secretOpt("crm_cron_secret");
    if (!expected || !safeEqual(cron, expected)) return new Response("forbidden", { status: 403 });
    const { data: todo, error } = await admin.from("crm_factures").select("id,numero,statut,envoi_tentatives")
      .in("statut", ["a_envoyer", "erreur"]).not("numero", "is", null).lt("envoi_tentatives", MAX_TENTATIVES)
      .order("numero");
    if (error) return json({ error: error.message }, 500);
    let envoyees = 0;
    const echecs: string[] = [];
    for (const f of todo ?? []) {
      try { await envoyer(f.id); envoyees++; } catch (e) { echecs.push(e instanceof Error ? e.message : String(e)); }
    }
    // Brouillons en attente de validation : rappel à l'équipe s'ils datent de plus de 2 jours.
    const { count: brouillons } = await admin.from("crm_factures").select("id", { count: "exact", head: true })
      .eq("statut", "brouillon").lt("created_at", new Date(Date.now() - 2 * 86400000).toISOString());
    if (echecs.length) { try { await alerteEquipe(echecs); } catch (e) { console.log("alerte:", String(e)); } }
    return json({ ok: true, envoyees, echecs: echecs.length, brouillons_en_attente: brouillons ?? 0 });
  }

  // ── Actions de l'équipe ──
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);
  let body: AnyObj = {};
  try { body = await req.json(); } catch { /* vide */ }
  const { action, id } = body;
  if (!id) return json({ error: "id manquant" }, 400);
  try {
    if (action === "apercu") {
      const f = await loadFacture(id);
      if (f.pdf_path) {
        const { data } = await admin.storage.from("factures").download(f.pdf_path);
        if (data) return json({ pdfBase64: encodeBase64(new Uint8Array(await data.arrayBuffer())), numero: f.numero });
      }
      const g = await generate(f, f.numero || "BROUILLON", f.date_emission || parisToday());
      return json({ pdfBase64: encodeBase64(g.pdf), numero: f.numero, warnings: g.warnings });
    }
    if (action === "envoyer") {
      const { data: f } = await admin.from("crm_factures").select("numero,statut").eq("id", id).maybeSingle();
      if (!f) return json({ error: "Facture introuvable" }, 404);
      if (!f.numero) {
        const { error } = await admin.rpc("crm_facture_emettre", { p_id: id });
        if (error) return json({ error: error.message }, 400);
      }
      const statut = await envoyer(id);
      const { data: after } = await admin.from("crm_factures").select("numero").eq("id", id).maybeSingle();
      return json({ ok: true, statut, numero: after?.numero });
    }
    if (action === "pdf") {
      const { data: f } = await admin.from("crm_factures").select("pdf_path").eq("id", id).maybeSingle();
      if (!f?.pdf_path) return json({ error: "PDF pas encore généré" }, 404);
      const { data, error } = await admin.storage.from("factures").createSignedUrl(f.pdf_path, 600);
      if (error) return json({ error: error.message }, 500);
      return json({ url: data.signedUrl });
    }
    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
