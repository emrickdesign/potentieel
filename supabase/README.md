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
  ligne `crm_clients`) et renvoie un **lien d'accès** que l'agence transmet au
  client. Aucun mot de passe n'est attribué : le client choisit le sien.
  Réservée aux emails de l'équipe, en dur dans la fonction.
  Appelée aussi avec le **seul email** d'un client existant pour lui regénérer un
  lien — d'où la règle interne : *n'écrire que les champs transmis*, sinon ce
  second appel effacerait le reste de sa fiche.
  Le lien renvoie vers `CLIENT_REDIRECT_URL` (défaut `https://potentieel.fr/reset`),
  **qui doit figurer dans les Redirect URLs de Supabase**.
- **`clients-income`** — revenus par client.
- **`notify-lead`** — notification à l'arrivée d'un lead.

### Stripe & facturation
`stripe-checkout` · `stripe-webhook` · `stripe-sync` · `stripe-metrics` ·
`stripe-forecast` · `send-invoice-email` · `send-quote-email` · `payment-alert-email`

> **Deux comptes Stripe**, un par entité de l'agence (les deux micro-entreprises
> de `COMPANY_INFO`, côté `admin.html`). Dans la fiche client, onglet Paiement,
> le sélecteur « ENCAISSER SUR » choisit le compte ; il est préréglé sur l'entité
> du client. L'entité qui encaisse est celle qui facture : le webhook pose
> `owner` = compte Stripe sur la facture qu'il crée.
>
> | | Clé secrète | Secret de signature du webhook |
> |---|---|---|
> | Emrick | `crm_stripe_secret_key` | `crm_stripe_webhook_secret` |
> | Éloïse | `crm_stripe_secret_key_eloise` | `crm_stripe_webhook_secret_eloise` |
>
> Chaque nom est lu d'abord dans l'env de la fonction (en MAJUSCULES), sinon
> dans le Vault. Un compte dont la clé manque est simplement **inactif** :
> `stripe-checkout` répond « compte pas encore connecté » et le webhook ignore
> ce secret. Les deux comptes partagent **le même endpoint de webhook** — c'est
> le secret qui valide la signature qui dit de quel compte vient l'événement.
>
> Les `price_…` fixes n'existent que sur le compte d'Emrick. Sur l'autre compte,
> `stripe-checkout` recrée le prix équivalent au premier usage et le retrouve
> ensuite par son `lookup_key` (`potentieel_sub_49`, `potentieel_setup_990`…).
>
> ⚠️ `stripe-sync`, `stripe-metrics` et `stripe-forecast` (Trésorerie, MRR)
> ne lisent **que** `STRIPE_SECRET_KEY`, donc le seul compte d'Emrick. Dès qu'un
> client encaissera chez Éloïse, ces chiffres seront incomplets : à étendre aux
> deux comptes le moment venu.

> **Envoi d'email** : `twilio-status` passe par Gmail en SMTP
> (`potentieel.web@gmail.com`, mot de passe d'application dans le Vault sous
> `crm_gmail_app_password`). Il était hors service jusqu'au 02/10/2026 — Google
> refusait un mot de passe qui n'avait jamais été vérifié. Réparé.
> ⚠️ Un échec d'envoi reste **silencieux** : il n'apparaît que dans les logs de la
> fonction, jamais dans le CRM. Procédure et commande de test dans
> [AJOUTER-UN-CLIENT.md](../AJOUTER-UN-CLIENT.md), étape 0b.

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
