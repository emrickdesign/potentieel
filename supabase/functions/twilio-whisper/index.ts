// Message d'annonce lu au client quand il décroche, avant la mise en relation.
// Appelé par Twilio via <Number url=...> depuis twilio-voice.
const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });

Deno.serve(() =>
  xml(`<Say language="fr-FR" voice="Polly.Lea">Appel provenant de Google Ads.</Say>`)
);
