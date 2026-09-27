import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/*
 * clients-income — les ENTREES de la tresorerie viennent des fiches clients
 * (crm_items section='clients'), plus de Stripe. Pour chaque fiche :
 *   - versements du site (sitePlan en Nx) : chaque case cochee = recu, sinon prevu.
 *     Un supplement 1er mois (siteFirstExtra) s'ajoute au 1er versement.
 *   - MRR mensuel : date de depart =
 *        mrrDepuis si renseigne (clients d'abonnement pur),
 *        sinon, si le client a un plan de site, le mois SUIVANT le dernier
 *        versement (firstPayDate + N mois) — maintenance apres solde du site.
 * Recu -> source='client' ; prevu (futur / non coche) -> source='projection'.
 * Reconciliation : delete source in ('client','projection') puis reinsere.
 * Réservée à l'équipe (table potentieel_equipe) : la clé anon publique ne suffit pas.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
type AnyObj = Record<string, any>;
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function requireTeam(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data: { user } } = await sb.auth.getUser(token);
  const email = (user?.email ?? "").toLowerCase();
  if (!email) return null;
  const { data } = await sb.from("potentieel_equipe").select("email").eq("email", email).maybeSingle();
  return data ? email : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireTeam(req))) return json({ error: "Non autorisé." }, 401);
  const HORIZON = 12;
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth();
  const curFirst = new Date(curY, curM, 1);
  const horizonFirst = new Date(curY, curM + HORIZON, 1);

  try {
    const { data: items, error } = await sb.from("crm_items").select("id, payload").eq("section", "clients");
    if (error) throw new Error(`Lecture fiches : ${error.message}`);
    const rows: AnyObj[] = [];

    for (const it of (items ?? [])) {
      const c = (it.payload ?? {}) as AnyObj;
      const cid = it.id;
      const nom = c.nom || "Client";

      const hasSite = c.sitePlan && c.siteFirstPayDate;
      const n = hasSite ? (parseInt(c.sitePlan) || 0) : 0;

      // 1) MRR mensuel — date de depart
      let mrrStart: string | null = c.mrrDepuis || null;
      if (!mrrStart && hasSite && n > 0) {
        const [fy, fm, fd] = String(c.siteFirstPayDate).split("-").map(Number);
        const d = new Date(fy, (fm - 1) + n, 1);
        const day = Math.min(fd || 1, lastDay(d.getFullYear(), d.getMonth()));
        mrrStart = ymd(d.getFullYear(), d.getMonth() + 1, day);
      }
      const mrr = parseFloat(c.mrr) || 0;
      if (mrr > 0 && mrrStart) {
        const [ay, am, ad] = String(mrrStart).split("-").map(Number);
        for (let k = 0; k < 120; k++) {
          const d = new Date(ay, (am - 1) + k, 1);
          if (d > horizonFirst) break;
          const day = Math.min(ad || 1, lastDay(d.getFullYear(), d.getMonth()));
          const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
          const future = d > curFirst;
          rows.push({
            type: "entree", amount: mrr, category: "ca",
            date: ymd(d.getFullYear(), d.getMonth() + 1, day),
            description: `${nom} — abonnement`,
            notes: future ? "Abonnement mensuel à venir" : "Abonnement mensuel",
            source: future ? "projection" : "client",
            external_id: `cli_${cid}_mrr_${ym}`,
          });
        }
      }

      // 2) Versements du site
      if (hasSite && n > 0) {
        const total = (typeof c.sitePrix === "number" && c.sitePrix > 0) ? c.sitePrix : 990;
        const unit = Math.round((total / n) * 100) / 100;
        const extra = (typeof c.siteFirstExtra === "number" && c.siteFirstExtra > 0) ? c.siteFirstExtra : 0;
        const vers = Array.isArray(c.siteVersements) ? c.siteVersements : [];
        const [fy, fm, fd] = String(c.siteFirstPayDate).split("-").map(Number);
        for (let i = 0; i < n; i++) {
          const d = new Date(fy, (fm - 1) + i, 1);
          const day = Math.min(fd || 1, lastDay(d.getFullYear(), d.getMonth()));
          const paid = !!vers[i];
          const amt = i === 0 ? Math.round((unit + extra) * 100) / 100 : unit;
          rows.push({
            type: "entree", amount: amt, category: "ca",
            date: ymd(d.getFullYear(), d.getMonth() + 1, day),
            description: `${nom} — site ${i + 1}/${n}${(i === 0 && extra > 0) ? " (+ suppl.)" : ""}`,
            notes: paid ? "Versement site reçu" : "Versement site à venir",
            source: paid ? "client" : "projection",
            external_id: `cli_${cid}_setup_${i}`,
          });
        }
      }
    }

    const del = await sb.from("transactions").delete().in("source", ["client", "projection"]);
    if (del.error) throw new Error(`Suppression : ${del.error.message}`);
    let inserted = 0;
    if (rows.length) {
      const ins = await sb.from("transactions").insert(rows);
      if (ins.error) throw new Error(`Insertion : ${ins.error.message}`);
      inserted = rows.length;
    }
    const recu = rows.filter(r => r.source === "client").length;
    return json({ ok: true, total: inserted, recu, prevu: inserted - recu });
  } catch (e) {
    console.log("clients-income:", e instanceof Error ? e.message : String(e));
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
