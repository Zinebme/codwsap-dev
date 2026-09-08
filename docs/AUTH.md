# Authentification CODWSAP

Ce document décrit le fonctionnement réel de l'authentification, ce qui a été
testé, et ce qui reste à configurer avant la mise en production.

---

## 1. Principe : Supabase Auth pour l'identité, CODWSAP pour le métier

| Responsabilité | Où |
| --- | --- |
| Mot de passe, hachage, vérification d'email, réinitialisation | Supabase Auth |
| OAuth Google / Apple, PKCE, rafraîchissement de jeton | Supabase Auth |
| Utilisateurs, marchands, rôles OWNER/ADMIN/AGENT | Base CODWSAP |
| Abonnements, plans, quotas, statut du marchand | Base CODWSAP |
| Autorisation (tenant, permissions, super admin) | Base CODWSAP |

Supabase Auth ne décide **jamais** de ce qu'un utilisateur a le droit de faire.
Il atteste seulement « cette personne contrôle cette adresse email ». Toutes les
décisions d'accès sont prises côté serveur à partir de la base CODWSAP.

## 2. Le point de passage unique : `currentUser()`

`src/server/auth/session.ts` expose `currentUser()`, utilisé par
`requireUser`, `requireTenant`, `requirePermission` et `requireSuperAdmin`.
Il accepte deux sources de session, dans cet ordre :

1. le **cookie historique** `codwsap_session` (JWT HS256, révocable par `jti`) ;
2. la **session Supabase** (cookies SSR), traduite en compte CODWSAP via la
   table `auth_identities`.

Conséquence importante : brancher Supabase sur ce seul point a suffi. Aucune
route, aucune page et aucune vérification de permission existante n'a dû être
modifiée, donc aucune régression d'autorisation n'a été introduite. Les 37
assertions de `npm run test:isolation` continuent de passer.

Dans les deux cas, le compte est **relu en base** et doit avoir `is_active = 1`.

## 3. Mapping `auth.users.id` → utilisateur CODWSAP

Table `auth_identities` (migration `0003_supabase_auth.sql`) :

| Colonne | Rôle |
| --- | --- |
| `user_id` | utilisateur CODWSAP |
| `supabase_user_id` | UUID du compte Supabase |
| `provider` | `email`, `google` ou `apple` |
| `email` | email vérifié au moment de la liaison (traçabilité) |

C'est une table, et non une colonne, parce qu'un même compte CODWSAP peut être
atteint par **plusieurs** identités. Contrainte `UNIQUE (supabase_user_id, provider)`.

## 4. Liaison d'identités et prévention des doublons

Scénario visé : un marchand s'inscrit par email/mot de passe, puis revient six
mois plus tard et clique « Continuer avec Google ». Il doit retrouver sa
boutique, pas en créer une seconde.

Logique de `linkSupabaseIdentity()` (`src/server/auth/identity.ts`) :

1. identité déjà liée → connexion, rien créé ;
2. sinon, un utilisateur CODWSAP porte déjà cet email → **rattachement** de la
   nouvelle identité au compte existant ;
3. sinon → création d'un utilisateur, **sans marchand**.

> **Garde-fou de sécurité.** Le rattachement (cas 2) n'est autorisé que si le
> fournisseur atteste `email_verified`. Sinon, n'importe qui pourrait créer un
> compte social portant l'email d'un marchand et récupérer son espace. Un email
> non vérifié est refusé (`email_unverified`), sans rien créer ni modifier.

## 5. Onboarding social atomique

Un utilisateur social n'a ni nom de boutique ni téléphone algérien. Il est donc
créé **sans marchand**, avec `onboarding_pending = 1`, et redirigé vers
`/bienvenue`.

`completeSocialOnboarding()` fait tout dans **une seule transaction** :

- complète l'utilisateur (nom, téléphone normalisé `+213`) ;
- crée le marchand (statut `trial`, essai de 14 jours) ;
- crée l'appartenance **OWNER** active ;
- crée l'abonnement `trial` / `trialing` ;
- installe les automatisations et les modèles WhatsApp par défaut.

Si une étape échoue, tout est annulé : **aucun marchand partiel** ne peut
subsister. L'opération est également **idempotente** (un double envoi du
formulaire ne crée pas un second marchand).

## 6. Parcours et routes

| Parcours | Route |
| --- | --- |
| Connexion | `/login` |
| Inscription | `/signup` |
| Mot de passe oublié | `/forgot-password` |
| Nouveau mot de passe | `/reset-password` |
| Onboarding social | `/bienvenue` |
| Callback OAuth / email (PKCE) | `/auth/callback` |
| Création du marchand social | `POST /api/auth/onboarding` |

Le middleware (`src/middleware.ts`) rafraîchit les jetons Supabase (qui expirent
au bout d'une heure) à chaque navigation. **Il n'autorise rien** : ce n'est pas
une barrière de sécurité, seulement un mécanisme de confort. Toute décision
d'accès reste prise côté serveur.

## 7. Messages d'erreur

Aucune erreur technique brute n'est affichée. `/auth/callback` redirige vers
`/login?error=<code>` et l'interface traduit le code en français **et en arabe** :

| Code | Sens |
| --- | --- |
| `config` | Supabase non configuré |
| `oauth` | échec du fournisseur |
| `expired` | lien expiré ou déjà utilisé |
| `unverified` | email non vérifié |
| `inactive` | compte désactivé |
| `no_email` | le fournisseur n'a transmis aucun email |
| `unknown` | erreur inattendue |

Sur « mot de passe oublié », la réponse est **toujours identique**, que l'email
existe ou non : révéler qu'une adresse est inconnue permettrait d'énumérer les
comptes de la plateforme.

## 8. Super Admin — inchangé

Le super admin **n'est pas** concerné par ce flux. Il n'est jamais créable
depuis l'inscription publique, reste créé par `npm run admin:create`, accède à
`/admin` via `requireSuperAdmin()` (`users.is_super_admin`), et son interface
demeure **en français uniquement**.

## 9. Ce qui est testé, et ce qui ne l'est pas

`npm run test:auth` — **24/24**, sur un vrai PostgreSQL avec les migrations
réelles :

- création d'un utilisateur social sans marchand ;
- reconnexion sans doublon ;
- Google puis Apple sur le même email vérifié → **un seul** utilisateur, **un
  seul** marchand, deux identités ;
- email non vérifié → fusion refusée, rien créé ;
- compte désactivé → refusé ;
- onboarding : marchand + OWNER + essai + automatisations + modèles ;
- idempotence de l'onboarding ;
- atomicité : un onboarding invalide ne laisse aucun marchand partiel.

**Non testé, et non revendiqué :** le dialogue réel avec Supabase Auth, Google
et Apple. Il exige un projet Supabase, des identifiants OAuth et un domaine
public, dont aucun n'est disponible dans l'environnement de développement. Le
code suit la documentation officielle `@supabase/ssr`, mais **une connexion
Google réelle n'a pas été exercée** et doit être validée en staging.

## 10. Comportement sans configuration Supabase

Si `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` sont
absentes, l'application fonctionne normalement avec l'authentification locale
par email/mot de passe. Le bouton Google affiche un message clair, et le
middleware ne fait rien. Aucun déploiement existant n'est cassé.

## 11. À configurer avant la production

1. Créer le projet Supabase et renseigner les deux variables `NEXT_PUBLIC_*`.
2. Supabase > Authentication > URL Configuration : `Site URL` = domaine public,
   `Redirect URLs` = `https://<domaine>/auth/callback`.
3. Activer la confirmation d'email (Authentication > Providers > Email).
4. Google : voir `docs/GOOGLE_OAUTH.md`.
5. Apple : voir `docs/APPLE_OAUTH.md` (bouton actuellement « Bientôt disponible »).
