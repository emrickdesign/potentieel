// Remplacée par pros-api (CRM Prospects séparé). Conservée vide : Supabase ne permet pas de la supprimer ici.
Deno.serve(() => new Response(JSON.stringify({ ok: false, error: "Fonction remplacée par pros-api" }), {
  status: 410,
  headers: { "Content-Type": "application/json" },
}));
