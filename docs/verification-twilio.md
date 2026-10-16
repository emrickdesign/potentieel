# Vérifier le suivi d'appels, de Twilio jusqu'au CRM

À dérouler dans l'ordre. Chaque étape dit **quoi regarder**, **ce qu'on doit
voir**, et **ce que ça veut dire si c'est faux**.

Projet Supabase : `alpzagoprkpzirgtrdup`
Base des fonctions : `https://alpzagoprkpzirgtrdup.supabase.co/functions/v1/`

---

## A. Côté Twilio

### A1. Le numéro existe et sait recevoir des appels

Console Twilio → **Phone Numbers → Manage → Active numbers**.

- Le numéro du client doit y figurer. Pour Tonio Rénov' : **+33 4 15 87 02 42**.
- Dans ses *Capabilities*, **Voice** doit être coché.

Si le numéro n'y est pas, rien d'autre ne peut marcher : il faut en acheter un
(Buy a number → France → Voice) avant de continuer.

### A2. Le webhook d'appel entrant

Cliquer sur le numéro → onglet **Configure** → section **Voice Configuration**.

| Champ | Valeur attendue |
|---|---|
| Configure with | **Webhook, TwiML Bin, Function, Studio Flow, Proxy Service** |
| A call comes in | **Webhook** |
| URL | `https://alpzagoprkpzirgtrdup.supabase.co/functions/v1/twilio-voice` |
| HTTP | **POST** |

**Une seule URL est à renseigner.** Les trois autres fonctions
(`twilio-whisper`, `twilio-status`, `twilio-recording`) sont appelées
automatiquement par la réponse de `twilio-voice` : il ne faut **pas** les
mettre ailleurs dans la console.

Pièges fréquents :

- *Configure with* réglé sur **Studio Flow** ou **TwiML App** : la fonction
  n'est alors jamais appelée, même si l'URL est écrite en dessous.
- **GET** au lieu de **POST** : la fonction reçoit une requête vide et répond
  « votre correspondant n'est pas joignable ».
- Une faute dans l'URL : Twilio joue son message d'erreur par défaut et
  raccroche. Rien n'arrive dans le CRM.

### A3. Les appels sortants vers la France sont autorisés

**Voice → Settings → Geo permissions** → onglet *Low Risk* : la **France**
doit être cochée.

C'est la panne la plus sournoise : l'appel entrant fonctionne, mais le
transfert vers le vrai numéro de l'artisan est bloqué. Le prospect entend
sonner puis tombe sur le répondeur, et l'appel est compté comme manqué alors
que l'artisan n'a jamais vu son téléphone sonner.

### A4. Le compte n'est pas en version d'essai

En haut du tableau de bord, si **« Trial »** apparaît :

- Twilio ajoute un message d'avertissement avant chaque appel ;
- il refuse d'appeler un numéro qui n'a pas été **vérifié** au préalable.

Un compte d'essai ne peut pas servir un client. Il faut l'alimenter
(*Upgrade*) avant la mise en service.

### A5. Le solde

**Billing → Overview**. Un solde à zéro coupe les appels sans prévenir et sans
erreur visible dans le CRM : les appels n'arrivent tout simplement plus.
Activer la **recharge automatique** évite la coupure un vendredi soir.

### A6. L'enregistrement des appels

Rien à régler dans la console : l'enregistrement est demandé par la fonction
elle-même (`record="record-from-answer-dual"`, les deux voix).

À vérifier en revanche dans **Voice → Settings → General** que
*Voice Recording Encryption* est **désactivé**. S'il est activé, Twilio chiffre
le fichier et `twilio-recording` ne pourra pas le récupérer : la demande
apparaîtra dans le CRM **sans** lecteur audio.

### A7. Le journal, après coup

**Monitor → Logs → Calls** : chaque appel y figure avec son statut, sa durée et
le détail des requêtes envoyées à nos fonctions. En cliquant sur un appel, la
section *Request Inspector* montre le code de réponse de chaque webhook —
`200` partout, sinon le problème est de notre côté.

---

## B. Le test réel — la seule preuve qui compte

À faire avec un téléphone qui n'est **pas** celui de l'artisan.

### B1. Appel décroché

1. Appeler le numéro de suivi.
2. L'artisan doit entendre **« Appel provenant de Google Ads »** avant d'être
   mis en relation.
3. Décrocher, parler une trentaine de secondes, raccrocher.
4. Dans le CRM → **Suivi ads** → le client → onglet **Demandes** : la demande
   doit apparaître (bouton **↻ Actualiser** si besoin) avec le badge
   **Répondu**, la bonne durée, et un **lecteur audio** qui joue vraiment.

> **Aucun mail n'est envoyé pour un appel décroché.** C'est voulu : l'artisan a
> eu le prospect au téléphone. Si vous attendiez un mail ici, c'est la raison
> pour laquelle vous n'en receviez pas.

### B2. Appel manqué — c'est ce test qui vérifie les mails

1. Rappeler le numéro de suivi et **laisser sonner sans décrocher**
   (22 secondes).
2. Le répondeur doit se déclencher : « Bonjour, nous ne sommes pas disponibles
   pour le moment… ». Laisser un message, puis raccrocher.
3. Attendre une à deux minutes.

Ce qui doit se produire :

| Où | Attendu |
|---|---|
| Boîte mail de l'agence | un mail **« ☎️ Appel manqué — <client> : +33… »** |
| Boîte mail du client | le même type de mail, **si** sa case *Notifications par email* est cochée dans sa fiche |
| CRM → Suivi ads | la demande avec le badge **Manqué**, puis **Répondeur** une fois l'enregistrement arrivé, et le message vocal écoutable |
| Barre latérale | le compteur de l'onglet **Suivi ads** augmente |

### B3. Si le mail n'arrive pas

Dans l'ordre :

1. **Regarder dans les indésirables.** Le mail part de `potentieel.web@gmail.com`
   vers vous-même : Gmail le classe parfois en spam.
2. **Vérifier l'adresse de destination.** Par défaut
   `emrick.perilliat2006@gmail.com`, remplaçable par la variable
   `AGENCY_NOTIFY_EMAIL`.
3. **Vérifier les journaux** : Supabase → *Edge Functions* → `twilio-status` →
   *Logs*. Une ligne `sendMail error` dit précisément ce qui a échoué.

Le mot de passe d'application Gmail est bien en place dans le coffre
(`crm_gmail_app_password`, mis à jour le 2 octobre). S'il a été révoqué côté
Google, il faut en régénérer un et le remettre dans le coffre.

---

## C. Vérifier le branchement au CRM

Le lien entre Twilio et le CRM ne tient qu'à **une seule chose** : le numéro
composé doit correspondre au champ `twilio_number` de la fiche client.

### C1. La fiche client

CRM → **Suivi ads** → le client → **Modifier**. Trois champs comptent :

- **Numéro de suivi** : exactement le numéro Twilio, au format international
  (`+33415870242`). La comparaison se fait sur les chiffres seuls, donc les
  espaces ne gênent pas — mais un chiffre faux casse tout.
- **Téléphone réel** : le portable de l'artisan, celui qui doit sonner.
- **Type de client** : **Ads (suivi complet)**. Avec « Site internet », la
  fonction ignore la fiche.
- La fiche doit être **active**.

### C2. Le symptôme d'un mauvais branchement

| Ce que vous constatez | Cause |
|---|---|
| Le prospect entend « votre correspondant n'est pas joignable » | aucune fiche ne correspond au numéro composé, ou le téléphone réel est vide |
| L'appel apparaît dans le CRM **sans nom de client** (à trier) | la fiche n'a pas été trouvée au moment de l'appel ; l'appel est quand même enregistré, il suffit de l'attribuer à la main dans la carte |
| Rien n'apparaît du tout | le webhook de l'étape A2 n'est pas bon |
| La demande apparaît mais sans audio | voir A6 (chiffrement) ou les identifiants Twilio côté Supabase |

### C3. Brancher un nouveau client

1. Acheter le numéro dans Twilio (France, Voice).
2. Lui poser le webhook de l'étape **A2**.
3. CRM → Suivi ads → **+ Nouveau client** : entreprise, email, téléphone réel,
   numéro de suivi, type **Ads**.
4. Faire les deux tests de la partie **B**.
5. Mettre le numéro de suivi dans les annonces Google Ads — **et nulle part
   ailleurs**, sinon les appels comptés comme venant de la publicité ne
   viendront pas tous de là.

---

## D. Deux points à traiter avant d'ouvrir le service

Ils ne concernent pas le réglage mais l'engagement pris au contrat.

1. **L'appelant n'est pas informé que l'appel est enregistré.** L'annonce
   actuelle est jouée à l'artisan, pas au prospect. Les CGV (article 11)
   promettent l'inverse : « l'appelant en est informé au début de l'appel ».
2. **Les enregistrements ne sont jamais supprimés** et le dossier où ils sont
   archivés est **public** : toute personne ayant l'adresse d'un fichier peut
   l'écouter. Les CGV annoncent une conservation de six mois maximum.
