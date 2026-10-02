import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Fonction de diagnostic temporaire, neutralisee le 20/07/2026.
// Elle ne lit plus rien chez Stripe. A supprimer depuis le dashboard Supabase :
// Edge Functions > stripe-debug-tmp > Delete.
Deno.serve(() =>
  new Response("Fonction de diagnostic desactivee. A supprimer.", { status: 410 })
);
