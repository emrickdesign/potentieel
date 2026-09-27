import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/*
 * stripe-forecast — DÉSACTIVÉE (27/09/2026).
 * Remplacée par clients-income (les entrées et prévisions viennent des fiches
 * clients depuis le 22/07/2026). Elle n'était plus appelée par le CRM mais
 * restait appelable avec la clé publique et SUPPRIMAIT toutes les transactions
 * source='projection' générées par clients-income. À supprimer du dashboard.
 */

Deno.serve(() =>
  new Response(JSON.stringify({ error: "Fonction désactivée — remplacée par clients-income." }), {
    status: 410,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
);
