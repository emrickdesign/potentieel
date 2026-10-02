# Fonctions Supabase — projet `alpzagoprkpzirgtrdup` (hub partagé)

Les « edge functions » sont de petits programmes qui tournent sur les serveurs de
Supabase. Elles font le travail que le site et le CRM ne peuvent pas faire seuls :
recevoir un appel Twilio, encaisser un paiement Stripe, envoyer un email, créer un
compte client.

## Comment c'est rangé

| Dossier | Contenu |
|---|---|
| `functions/` | Les fonctions **de ce projet**. Déployables telles quelles. |
| `sauvegarde-autres-fonctions/` | Fonctions présentes sur le **même hub Supabase** mais qui n'appartiennent pas à ce site : autre projet, ou fonctions neutralisées. **Sauvegarde seule, à ne jamais déployer d'ici.** |

Le hub Supabase est partagé entre plusieurs projets (voir la convention des tables
préfixées). Toutes les fonctions du hub se retrouvent donc dans la même liste côté
Supabase, même celles qui ne concernent pas ce site.

## Les fonctions de ce projet (`functions/`)

### Appels entrants — c'est le cœur du Suivi ads

L'enchaînement complet, dans l'ordre où ça se passe :

1. **`twilio-voice`** — quelqu'un appelle le numéro de suivi d'un client.
   Retrouve le client par son `twilio_number`, crée la ligne dans `ads_calls`
   (c'est **ici** que `client_id` est posé), puis transfère vers son vrai téléphone
   en déclenchant l'enregistrement. Sans client rattaché : message d'excuse + raccroché.
2. **`twilio-whisper`** — ce que le client entend en décrochant :
   « Appel provenant de Google Ads ».
3. **`twilio-status`** — fin de l'appel : passe en `repondu` (+ durée) ou `manque`,
   et prévient le client par email s'il a coché l'option.
4. **`twilio-recording`** — récupère l'enregistrement chez Twilio, l'archive dans
   Storage (`ads-recordings`), et requalifie un `manque` en `repondeur` si un message
   a été laissé.
5. **`call-transcribe`** — transcription + résumé d'un appel, à la demande depuis le CRM.

### Clients
- **`client-invite`** — crée le compte de l'espace client (utilisateur auth +
  ligne `crm_clients`). Réservé aux emails de l'équipe, en dur dans la fonction.
- **`clients-income`** — revenus par client.
- **`notify-lead`** — notification à l'arrivée d'un lead.

### Stripe & facturation
`stripe-checkout` · `stripe-webhook` · `stripe-sync` · `stripe-metrics` ·
`stripe-forecast` · `send-invoice-email` · `send-quote-email` · `payment-alert-email`

### Rendez-vous
`calendly-sync` · `send-call-confirmation` · `send-call-reminders`

### Réseaux sociaux
`metricool` — prévu pour les onglets « Google My Business » et « Réseaux sociaux »
du Suivi ads, en attente de la clé API (plan Advanced).

## Le dossier de sauvegarde

| Fonction | Pourquoi elle est là |
|---|---|
| `pros-api` (+ `parse.ts`) | Serveur du **CRM Prospects** (`crm-prospects-ten.vercel.app`, tables `pros_*`). Projet distinct, sans dépôt à lui pour l'instant. |
| `pros-acces` | Gestion des accès de l'équipe du CRM Prospects. |
| `meta-leads` | Remplacée par `pros-api`, renvoie 410. Supabase ne permet pas de la retirer autrement. |
| `stripe-debug-tmp` | Diagnostic temporaire neutralisé le 20/07/2026, renvoie 410. **À supprimer** depuis le tableau de bord Supabase. |

Si le CRM Prospects reçoit un jour son propre dépôt, `pros-api` et `pros-acces`
doivent y déménager.

## Pourquoi ces fichiers existent

Le 02/10/2026, **7 fonctions déployées n'avaient aucune source ici** : leur code
n'existait que sur les serveurs de Supabase. Aucun historique, aucune copie, et
rien à redéployer si l'une d'elles était supprimée ou cassée — y compris
`twilio-voice`, dont dépend chaque appel reçu par chaque client.

Elles ont été récupérées **à l'identique de la production**, sans retouche ni
commentaire ajouté, pour qu'une comparaison future reste fiable.

## Récupérer ou comparer une source

La CLI Supabase convient si le compte connecté a accès au projet :

```bash
npx supabase functions download <nom> --project-ref alpzagoprkpzirgtrdup
```

Si elle répond `403`, c'est que le compte connecté n'a pas les droits sur ce
projet — passer par le tableau de bord Supabase, ou par un accès qui les a.

## Règle à tenir

Toute fonction créée ou modifiée directement dans le tableau de bord Supabase
doit être **recopiée ici dans la foulée**. Sinon on recrée exactement le trou qui
a motivé ce dossier.
