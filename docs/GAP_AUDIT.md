# Audit final — état vérifiable et écarts restants

Date : 2026-09-08 · Branche : `arena/01a080d4-codwsap-dev`

Ce document sépare rigoureusement ce qui est **vérifié par des tests
automatisés** de ce qui **exige des identifiants ou un environnement public**
et n'est donc PAS revendiqué comme fonctionnel. Rien ici n'est inventé :
chaque écart indique ce qu'il faut pour le lever.

---

## 1. Socle vérifié (roadmap, état actuel)

| Suite | Commande | Résultat | Ce qu'elle couvre |
| --- | --- | --- | --- |
| Isolation multi-tenant | `npm run test:isolation` | 37/37 | 12 tests applicatifs (tenant résolu côté serveur, 401/403, webhooks signés, cron protégé) + 9 autorisations HTTP réelles + 16 tests RLS PostgreSQL (rôle restreint `codwsap_tenant`) |
| Authentification | `npm run test:auth` | 24/24 | Liaison d'identités Supabase, anti-doublon Google/Apple, email non vérifié refusé, onboarding social atomique et idempotent |
| Livraison | `npm run test:delivery` | 24/24 | Intégrité du catalogue (38 sociétés, 5 moteurs), capacités, normalisation fr/ar/en, refus sans identifiants, webhooks — **hors ligne** |
| Équipe | `npm run test:team` | 44/44 | Invitations (jeton haché, usage unique, expiration), anti-usurpation de compte, limites de plan à la création ET à l'acceptation, retrait, audit |
| Super admin | `npm run test:admin-ops` | 19/19 | Rejeu/suppression de jobs, rejeu de webhooks transporteurs (idempotence prouvée), alerte `job_failed`, audit des actions |
| WhatsApp | `npm run test:whatsapp` | 22/22 | Variables de template positionnelles (payload Cloud API réel construit), preuves de disponibilité (accusés ≥ échec 131026), interrupteur `failed_message_alert` |
| Google Sheets | `npm run test:sheets` | 28/28 | Parsing CSV, correspondance de colonnes, normalisation téléphone/prix, idempotence, transitions d'état, **les deux chemins d'URL réels** via stub de fetch |
| Telegram | `npm run test:telegram` | 17/17 | Échappement Markdown, URL/chat depuis les identifiants chiffrés, refus définitif vs transitoire, job `notify_telegram` de bout en bout, via stub de fetch |

Qualité : `npm run verify` (typecheck + lint + build) passe. Migrations
0001→0005 idempotentes et testées sur PostgreSQL réel (binaires embarqués).
Le dialecte SQLite portable est vérifié via `npm run seed`.

### Progression de la feuille de route

1. **Gestion d'équipe + rôles/invitations** — terminé (liens à usage unique,
   anti-usurpation, limites de plan, audit).
2. **Observabilité super admin** — terminé (file de jobs actionnable, rejeu
   de webhooks transporteurs, tendance 7 jours, alertes).
3 **WhatsApp Cloud API** — terminé côté plateforme (variables positionnelles,
   preuves de disponibilité) ; le dialogue réel avec Meta reste
   identifiant-dépendant (voir §3).
4. **Automatisations** — terminé (interrupteur `failed_message_alert` réel,
   aperçu de message).
5. **Google Sheets** — terminé côté plateforme (détection d'en-têtes,
   résumés de synchro) ; la lecture réelle d'une feuille exige une vraie
   feuille partagée (voir §3).
6. **Telegram** — terminé (chemin d'envoi unique, échappement, docs).
7. **Intégrations transporteurs en direct** — prêt à l'activation, bloqué sur
   identifiants (voir §2).
8. **Présent audit** — ce document.

---

## 2. Intégrations transporteurs en direct (item 7) — comment activer

La couche est **prête à l'emploi** : identifiants chiffrés par marchand,
bouton « Tester » (`testConnection`), capacités par moteur, normalisation des
statuts, webhooks signés HMAC, rejeu super admin. Catalogue : 38 sociétés,
5 moteurs — 7 `public`, 22 `engine`, 9 `unverified` (signalés dans l'UI).

Par moteur, pour passer en direct :

| Moteur | Sociétés | Identifiants requis | Procédure de validation |
| --- | --- | --- | --- |
| `yalidine` | Yalidine + marques dérivées (6) | API ID + API key (espace Yalidine) | Tester la connexion → créer UNE expédition réelle → vérifier le suivi + le webhook |
| `procolis` | Procolis, ZR Express… (6) | Jeton API (espace Procolis/ZR) | idem |
| `ecotrack` | 14 sociétés | URL de l'instance + jeton | idem, par société (chaque instance a son URL) |
| `custom` | 10 sociétés | URL API/chemins OU secret webhook seul | mode webhook : communiquer l'URL `/api/webhooks/delivery/{connectionId}` au transporteur |
| `sandbox` | simulateur | aucun | déjà utilisable en démonstration |

**Aucun de ces appels réels n'a été effectué** (aucun identifiant disponible
dans l'environnement de développement). Les tests `test:delivery` prouvent
la conformité du catalogue, des capacités et de la normalisation — pas le
dialogue réseau. Dès qu'un marchand fournit ses identifiants en staging :
bouton « Tester », envoi réel d'un colis, vérification du webhook, puis
passage en production. Chaque appel est journalisé dans `api_logs` (visible
super admin).

Les 9 sociétés `unverified` affichent « documentation requise » dans l'UI :
leurs endpoints ne sont pas confirmés publiquement, aucune n'est connectable
par erreur.

---

## 3. Écarts restants — par ordre de priorité

### 3.1 Dialogue réel WhatsApp Cloud API (bloqué : compte Meta Business)
- **Manque** : numéro WhatsApp Business réel, `phone_number_id`, jeton
  permanent, templates approuvés par Meta.
- **Fait et testé hors ligne** : construction du payload exact attendu par
  `graph.facebook.com/v21.0` (paramètres positionnels du composant « body »),
  langue du template, statuts webhook, preuves de disponibilité.
- **Non implémenté (volontaire)** : la **soumission de templates à Meta**.
  Le marchand déclare le résultat de la revue Meta lui-même (miroir honnête,
  jamais fabriqué). La soumission automatique via l'API de gestion des
  templates est un chantier séparé.

### 3.2 Authentification Supabase réelle + Google/Apple (bloqué : projet Supabase + domaine public)
- Les parcours (callback OAuth, liaison d'identités, mot de passe oublié)
  sont implémentés et leur **logique** testée (24/24). Le dialogue réel
  exige `NEXT_PUBLIC_SUPABASE_URL`/`PUBLISHABLE_KEY` et des redirect URI
  publics — voir `docs/AUTH.md`, `docs/GOOGLE_OAUTH.md`, `docs/APPLE_OAUTH.md`
  qui marquent explicitement « non vérifié dans cet environnement ».

### 3.3 Lecture réelle Google Sheets (bloqué : vraie feuille partagée)
- Les deux chemins (API v4 avec clé, export CSV public) construisent des URL
  réelles, testées via stub. La validation finale exige une feuille réelle
  partagée : détecter les colonnes, synchroniser, vérifier les commandes.

### 3.4 Canal email des notifications (non câblé — décision produit)
- Les préférences proposent un canal « email » par type d'évènement, mais
- **aucun fournisseur email n'est intégré** (Resend, SES…). Seuls le tableau
  de bord et Telegram émettent réellement. Décision à prendre : fournisseur
  + domaines vérifiés, ou retrait du canal email de l'interface.

### 3.5 Types de notifications déclarés mais jamais émis
- `token_expired`, `template_rejected`, `high_failure_rate`,
  `low_quality_warning`, `subscription_issue` apparaissent dans les
  préférences marchands mais **aucun code ne les déclenche aujourd'hui**.
  Déclencheurs naturels à implémenter : contrôle périodique des jetons
  transporteurs/WhatsApp, suivi des métriques qualité Meta (via la connexion
  et les webhooks), échéances d'abonnement.

### 3.6 Divers
- **Facturation** : changements de plan manuels par l'équipe (super admin),
  aucun paiement en ligne — conforme au choix actuel.
- **`vercel.json`** déclare un cron quotidien ; en production le
  planificateur recommandé reste **Supabase Cron toutes les 1–5 min**
  (`docs/DEPLOYMENT_VERCEL_SUPABASE.md` §6) pour drainer la file de jobs.
- **Impression d'étiquettes** : non implémentée et non annoncée dans l'UI
  (test `test:delivery` le vérifie).

---

## 4. Ordre de passage en production recommandé

1. Déployer sur Vercel + Supabase (guide §`docs/DEPLOYMENT_VERCEL_SUPABASE.md`),
   `CRON_SECRET` et `CREDENTIALS_KEY` définis, migrations 0001→0005 appliquées.
2. Créer le super admin (`npm run admin:create`), configurer Supabase Auth.
3. Connecter WhatsApp d'un marchand pilote (identifiants réels) et valider :
   test de connexion, template approuvé, envoi réel, webhook.
4. Connecter un transporteur pilote (Yalidine ou Procolis) et valider le
   cycle complet : création de colis → suivi → webhook → automatisations.
5. Activer Telegram pour les alertes, puis Google Sheets pour un marchand
   avec une feuille réelle.
6. Traiter §3.5 (déclencheurs de notifications) et §3.4 (décision email)
   avant l'ouverture générale.
