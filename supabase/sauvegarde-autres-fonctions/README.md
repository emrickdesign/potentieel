# Sauvegarde — fonctions du hub qui n'appartiennent pas à ce projet

**Ne rien déployer depuis ce dossier.** Il n'existe que pour qu'aucun code ne vive
uniquement sur les serveurs de Supabase.

Le hub `alpzagoprkpzirgtrdup` est partagé entre plusieurs projets : sa liste de
fonctions mélange donc celles de ce site et celles d'ailleurs. Les quatre
ci-dessous sont dans le second cas.

| Fonction | Statut | À faire |
|---|---|---|
| `pros-api` (+ `parse.ts`) | **Active** — serveur du CRM Prospects (`crm-prospects-ten.vercel.app`, tables `pros_*`) : leads Meta, agendas des closers, devis et signature, notifications push. | Déménager quand le CRM Prospects aura son dépôt. |
| `pros-acces` | **Active** — accès de l'équipe du CRM Prospects (invitations à usage unique). | Idem. |
| `meta-leads` | Neutralisée — renvoie 410, remplacée par `pros-api`. | Rien : Supabase ne permet pas de la retirer proprement. |
| `stripe-debug-tmp` | Neutralisée le 20/07/2026 — renvoie 410, ne lit plus rien chez Stripe. | **Supprimer** : tableau de bord Supabase → Edge Functions → `stripe-debug-tmp` → Delete. |

Sources récupérées le 02/10/2026, à l'identique de la production.
