# Ajouter un nouveau client Ads

Marche à suivre complète, de l'achat du numéro jusqu'au premier appel vérifié.
Compter 20 minutes, dont 10 d'attente côté Twilio.

---

## Étape 0 — À faire UNE SEULE FOIS (pas à chaque client)

Ces deux réglages conditionnent tous les clients. **Les deux sont faits
depuis le 02/10/2026** — cette section ne sert plus qu'à les rétablir s'ils
sautent. Pour un nouveau client, commencer directement à l'étape 1.

### a) Autoriser la page de mot de passe dans Supabase — fait le 02/10/2026 ✅

Le hub Supabase est partagé entre tous les sites clients et n'a qu'une seule
« Site URL » (`https://acquisition.linkprime.fr/`, qui appartient à un autre
projet). Chaque site doit donc déclarer sa propre page de retour, sinon ses
clients sont renvoyés chez le voisin.

`https://potentieel.fr/reset` est désormais dans les **Redirect URLs**
(Authentication → URL Configuration). **Ne jamais modifier la Site URL** pour
« corriger » ce genre de problème : elle sert à un autre site.

Pour revérifier à tout moment — un jeton volontairement invalide suffit, rien
n'est consommé et aucun compte n'est touché :

```bash
curl -s -o /dev/null -D - "https://alpzagoprkpzirgtrdup.supabase.co/auth/v1/verify?token=invalide&type=recovery&redirect_to=https%3A%2F%2Fpotentieel.fr%2Freset" | grep -i '^location:'
```

L'en-tête `Location` doit commencer par `https://potentieel.fr/reset`. S'il pointe
vers `acquisition.linkprime.fr`, l'autorisation a sauté.

### b) Le canal d'envoi d'emails — réparé le 02/10/2026 ✅

Gmail refusait les identifiants (`535 BadCredentials`) : le mot de passe
d'application posé le 27/09 n'avait jamais fonctionné, et personne ne pouvait
s'en apercevoir puisqu'aucun appel n'était encore arrivé. Un nouveau mot de passe
d'application a été généré depuis `potentieel.web@gmail.com` et remplacé dans le
Vault (`crm_gmail_app_password`). L'authentification SMTP passe désormais.

Si ça recasse un jour — Google révoque ces mots de passe au moindre changement de
sécurité sur le compte :

1. Se connecter à **`potentieel.web@gmail.com`** (l'adresse d'envoi est écrite en
   dur dans `twilio-status`, aucun secret `GMAIL_USER` ne la remplace).
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   → en générer un nouveau. La validation en 2 étapes doit être active.
3. Retirer les espaces, puis remplacer la valeur dans le Vault Supabase sous
   `crm_gmail_app_password` (ne pas en créer un second).
4. Retester avec la commande de l'étape 6.

⚠️ **L'envoi échoue en silence.** En cas de problème, rien n'apparaît dans le CRM :
l'erreur ne va que dans les logs de `twilio-status`. C'est la faiblesse à garder en
tête — un canal d'email muet donne l'illusion de fonctionner.

---

## Étape 1 — Le numéro de suivi Twilio

C'est le seul morceau entièrement manuel, et rien dans le CRM ne peut vérifier
qu'il est fait. À soigner.

1. Console Twilio → **Phone Numbers** → **Buy a number** (France, capacité Voice).
2. Ouvrir le numéro acheté, section **Voice Configuration** :
   - *A call comes in* : **Webhook**
   - URL : `https://alpzagoprkpzirgtrdup.supabase.co/functions/v1/twilio-voice`
   - Méthode : **HTTP POST**
3. **Save**.

Rien d'autre à configurer : les rappels de fin d'appel et d'enregistrement sont
déclarés par `twilio-voice` lui-même dans sa réponse.

---

## Étape 2 — Créer le client dans le CRM

CRM → **Suivi ads** → **+ Nouveau client**

| Champ | À quoi il sert |
|---|---|
| Entreprise, Nom du contact | Affichage dans le CRM et dans son espace |
| **Email de connexion** | Son identifiant. C'est aussi la clé de son compte : à ne plus changer ensuite. |
| Type de client | `Ads` = suivi complet (appels + leads). `Site` = site vitrine seul. |
| **Téléphone réel** | Le numéro vers lequel l'appel est transféré. Son vrai portable. |
| **Numéro Twilio de suivi** | Celui acheté à l'étape 1, au format `+33…` |
| ID marque Metricool | Laisser vide (réservé pour plus tard) |
| Lien de la fiche Google | Son établissement Google, affiché dans son espace |
| Notifier par email | **Laisser décoché pendant les tests.** Voir l'étape 6. |

→ **Créer le compte**

Aucun mot de passe n'est demandé : c'est voulu. Le client choisira le sien.

---

## Étape 3 — Lui transmettre son accès

Après la création, la fenêtre affiche un **lien d'accès**. Bouton **Copier le lien**,
puis l'envoyer par WhatsApp ou SMS.

Ce qu'il faut savoir :
- Le client ouvre le lien, **choisit son mot de passe**, et arrive dans son espace.
- **Tu ne connais jamais son mot de passe.** C'est voulu : si son compte est utilisé,
  rien ne te sera imputable.
- Le lien **expire au bout de quelques heures**. S'il traîne, pas de panique :
  sa fiche a un bouton **🔑 Lien d'accès** qui en regénère un, autant de fois
  que nécessaire.
- Son espace est sur `https://potentieel.fr/espace-client`, connexion par
  `https://potentieel.fr/auth`.

---

## Étape 4 — Ce que le client voit

Volontairement restreint, par les règles de sécurité de la base :

- **ses** demandes uniquement, jamais celles d'un autre client
- parmi elles : les appels **qualifiés** par toi, et **tous les appels manqués**
- les formulaires **qualifiés** seulement

Autrement dit, un appel que tu n'as pas encore trié lui reste invisible. Tu gardes
la main sur ce qui lui est montré.

Pour voir exactement son écran : sa fiche → **👁 Espace client**.

---

## Étape 5 — Vérifier par un vrai appel

Ne pas sauter cette étape : c'est la seule preuve que la chaîne est branchée.

1. Appeler le numéro de suivi depuis un portable.
2. Attendu : ça sonne sur son téléphone réel, et la personne qui décroche entend
   « Appel provenant de Google Ads ».
3. Dans **Suivi ads → le client**, l'appel apparaît avec son enregistrement.
4. Recommencer **sans décrocher** : l'appel doit arriver marqué **Manqué**, faire
   monter le compteur « À rappeler », et le bouton **Marquer rappelé** doit le
   faire redescendre.

Si rien n'apparaît, regarder dans l'ordre : le webhook Twilio de l'étape 1, puis
les logs de `twilio-voice` dans Supabase.

---

## Étape 6 — Le jour du lancement

Quand ses publicités tournent vraiment et que les appels sont de vrais prospects :

Sa fiche → **Modifier** → cocher **« Notifier le client par email quand il rate un
appel »** → Enregistrer.

Tant que l'étape 0b n'est pas réglée, cette case ne produira rien.

Pour tester le canal d'envoi sans attendre un vrai appel (le mail part vers
l'agence uniquement, aucun client n'est dérangé) :

```bash
curl -s -X POST "https://alpzagoprkpzirgtrdup.supabase.co/functions/v1/twilio-status" -d "CallSid=TEST-$(date +%s)" -d "DialCallStatus=no-answer" -d "From=%2B33600000000"
```

Puis lire les logs de `twilio-status` dans Supabase : en cas d'échec, l'erreur y
est écrite — **et nulle part ailleurs**. L'envoi d'email échoue en silence, c'est
une faiblesse connue de la fonction.

---

## Récapitulatif

| # | Étape | Où |
|---|---|---|
| 0a | Autoriser `potentieel.fr/reset` | Supabase · une seule fois |
| 0b | Réparer le mot de passe Gmail | Google + Vault · une seule fois |
| 1 | Acheter le numéro et le pointer sur `twilio-voice` | Twilio |
| 2 | Créer le client | CRM |
| 3 | Copier le lien d'accès et l'envoyer | CRM → WhatsApp |
| 4 | — | le client choisit son mot de passe |
| 5 | Appel de test, décroché puis manqué | ton portable |
| 6 | Cocher la notification email | CRM, au lancement |
