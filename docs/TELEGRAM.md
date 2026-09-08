# Alertes Telegram — configuration

Durée : environ 10 minutes. À faire par chaque marchand qui veut recevoir ses
alertes sur Telegram (nouvelles commandes, échecs de livraison, webhooks en
erreur, synchronisations Google Sheets…).

> **Vérifiable immédiatement.** Contrairement aux intégrations transporteurs,
> le bouton « Tester » de la page Intégrations envoie un VRAI message via votre
> bot : si le test réussit, les alertes réelles suivent exactement le même
> chemin (`src/server/services/telegram.ts`).

---

## 1. Créer le bot

1. Dans Telegram, ouvrez une conversation avec [@BotFather](https://t.me/BotFather).
2. Envoyez `/newbot` et suivez les instructions (nom du bot, identifiant).
3. BotFather répond avec un **token** de la forme `123456789:AAE3…`.
   Conservez-le : il sera stocké **chiffré** côté serveur (AES-256-GCM) et
   jamais renvoyé au navigateur — la page Intégrations n'affiche qu'un
   aperçu masqué.

## 2. Récupérer votre chat ID

Le bot ne peut écrire qu'aux conversations où il a été ajouté (ou qui lui ont
écrit) :

1. Envoyez n'importe quel message à votre nouveau bot (bouton **Start**).
2. Ouvrez `https://api.telegram.org/bot<TOKEN>/getUpdates` dans un navigateur.
3. Cherchez `"chat":{"id":…}` dans la réponse : ce nombre est votre **chat ID**.
   - Pour un canal public, le chat ID est `@nom_du_canal` (ajoutez le bot au
     canal en administrateur avec la permission « poster des messages »).

## 3. Connecter dans CODWSAP

1. Tableau de bord → **Intégrations** → carte Telegram → **Configurer**.
2. Collez le token et le chat ID, enregistrez.
3. Cliquez sur **Tester** : vous devez recevoir un message sur Telegram.

Si le test échoue :
- `Unauthorized` → token erroné ou révoqué (regardez BotFather, `/token`) ;
- `chat not found` → le chat ID est faux, ou vous n'avez jamais écrit au bot ;
- `bot was blocked` → débloquez le bot dans Telegram.

## 4. Choisir quelles alertes recevoir

Tableau de bord → **Paramètres** → **Notifications** : chaque type d'évènement
(nouvelle commande, colis au bureau, échec de livraison…) a trois canaux —
tableau de bord, Telegram, email. Cochez Telegram pour les types voulus.

## Comportement de la plateforme

- Les envois passent par la file de traitements (`jobs`) : une panne
  transitoire (429, réseau) est retentée automatiquement (1 / 5 / 15 min),
  puis le marchand reçoit une alerte tableau de bord si l'échec persiste.
- Un refus **définitif** (token révoqué, chat introuvable) marque
  l'intégration en erreur : elle s'affiche sur la page Intégrations.
- Les données dynamiques (noms clients, références) sont échappées avant
  l'envoi : un nom contenant `_`, `*` ou `[` ne peut pas casser le message.
- Chaque appel est journalisé (`api_logs`, service `telegram`) et visible par
  le super admin dans la console d'observabilité.
