# Connexion Google — configuration

Durée : environ 15 minutes. À faire une fois par environnement (staging, production).

> **Non vérifié dans cet environnement.** Cette procédure suit la documentation
> officielle Google et Supabase, mais aucune connexion Google réelle n'a pu être
> exercée pendant le développement (ni projet Supabase, ni domaine public).
> Validez le parcours en staging avant d'ouvrir aux marchands.

---

## 1. Créer les identifiants OAuth chez Google

1. Ouvrez [console.cloud.google.com](https://console.cloud.google.com/) et créez
   un projet (ex. `CODWSAP`).
2. **APIs & Services > OAuth consent screen** :
   - Type **External**.
   - Nom de l'application, email d'assistance, email du développeur.
   - Domaine autorisé : votre domaine public (ex. `codwsap.com`).
   - Scopes : `email`, `profile`, `openid` suffisent. N'en demandez pas d'autres :
     tout scope supplémentaire déclenche une revue Google longue et inutile ici.
3. **APIs & Services > Credentials > Create credentials > OAuth client ID** :
   - Type **Web application**.
   - **Authorized JavaScript origins** : `https://<votre-domaine>`
   - **Authorized redirect URIs** :
     ```
     https://<ref-projet>.supabase.co/auth/v1/callback
     ```
     C'est bien l'URL **Supabase**, pas celle de votre application. Google
     renvoie vers Supabase, qui renvoie ensuite vers `/auth/callback`.
4. Notez le **Client ID** et le **Client Secret**.

## 2. Déclarer Google dans Supabase

Tableau de bord Supabase > **Authentication > Providers > Google** :

1. Activez le fournisseur.
2. Collez le **Client ID** et le **Client Secret**.
3. Enregistrez.

Puis **Authentication > URL Configuration** :

- `Site URL` : `https://<votre-domaine>`
- `Redirect URLs` : `https://<votre-domaine>/auth/callback`

Sans cette dernière entrée, Supabase refuse la redirection et l'utilisateur
retombe sur `/login?error=oauth`.

## 3. Variables d'environnement Vercel

Aucune variable Google n'est nécessaire côté application : le secret reste chez
Supabase. Seules ces deux variables sont requises :

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref-projet>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clé publiable>
```

Le **Client Secret Google ne doit jamais** être ajouté aux variables Vercel de
ce projet : il n'y sert à rien et toute variable `NEXT_PUBLIC_*` serait exposée
au navigateur.

## 4. Vérifier le parcours

1. `/login` > « Continuer avec Google ».
2. Choisir un compte Google.
3. Retour sur `/auth/callback`, puis :
   - **premier compte** → `/bienvenue` (nom, boutique, téléphone) → `/dashboard` ;
   - **compte connu** → `/dashboard` directement.
4. Vérifiez en base qu'il n'existe **qu'un** enregistrement dans `merchants`
   pour ce marchand, et deux lignes dans `auth_identities` si l'utilisateur
   s'était d'abord inscrit par mot de passe.

## 5. Problèmes fréquents

| Symptôme | Cause | Correction |
| --- | --- | --- |
| `redirect_uri_mismatch` | l'URI Google ne correspond pas | l'URI doit être `https://<ref>.supabase.co/auth/v1/callback`, au caractère près |
| Retour sur `/login?error=oauth` | l'URL de retour n'est pas autorisée | ajoutez `/auth/callback` dans « Redirect URLs » de Supabase |
| `/login?error=unverified` | email non vérifié par Google | comportement volontaire : protection contre l'usurpation de compte |
| Écran « application non vérifiée » | consent screen en mode test | passez en **Production**, ou ajoutez des utilisateurs de test |
| Boucle de redirection | `Site URL` incorrecte | elle doit correspondre exactement au domaine servi |

## 6. Passage en production

Tant que l'écran de consentement est en mode *Testing*, seuls les comptes
ajoutés comme testeurs peuvent se connecter, et un avertissement s'affiche.
Publiez l'application (**OAuth consent screen > Publish app**). Avec les seuls
scopes `email`, `profile` et `openid`, aucune revue de sécurité Google n'est
requise.
