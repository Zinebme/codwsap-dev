# Connexion Apple — état et configuration

## État actuel : « Bientôt disponible »

Le bouton « Continuer avec Apple » est affiché sur `/login` et `/signup`, mais
**désactivé**, avec la mention « Bientôt disponible ».

C'est un choix délibéré : « Sign in with Apple » exige un compte **Apple
Developer Program payant (99 USD/an)** et une vérification de domaine. Tant que
ce compte n'existe pas, un bouton actif échouerait systématiquement. Un bouton
honnêtement désactivé vaut mieux qu'un bouton cassé.

**L'architecture, elle, est complète.** Apple emprunte exactement le même chemin
que Google : `signInWithOAuth` → Supabase → `/auth/callback` → PKCE →
`linkSupabaseIdentity()` → onboarding. L'activation ne demande aucune logique
nouvelle, seulement la configuration ci-dessous et le remplacement de
`provider: "google"` par `provider: "apple"` dans un bouton actif.

---

## 1. Prérequis

- Compte **Apple Developer Program** actif (99 USD/an).
- Un domaine public en HTTPS.

## 2. Configuration côté Apple

Sur [developer.apple.com](https://developer.apple.com/account/resources/) :

1. **Identifiers > App ID** — créez un App ID et activez la capacité
   **Sign In with Apple**. Notez le **Team ID** (en haut à droite du compte).
2. **Identifiers > Services ID** — créez un Services ID (ex.
   `com.codwsap.web`). C'est lui qui joue le rôle de « Client ID » côté web.
   - Activez **Sign In with Apple**, puis **Configure** :
     - *Domains and Subdomains* : `<votre-domaine>`
     - *Return URLs* : `https://<ref-projet>.supabase.co/auth/v1/callback`
3. **Keys** — créez une clé, activez **Sign In with Apple**, téléchargez le
   fichier `.p8`.
   > Le fichier `.p8` n'est téléchargeable **qu'une seule fois**. Conservez-le
   > dans un gestionnaire de secrets, jamais dans le dépôt Git.
   Notez le **Key ID**.
4. **Vérification de domaine** : Apple fournit un fichier à déposer sous
   `/.well-known/apple-developer-domain-association.txt`.

Éléments à réunir : **Team ID**, **Services ID**, **Key ID**, fichier **.p8**.

## 3. Configuration côté Supabase

Tableau de bord Supabase > **Authentication > Providers > Apple** :

- *Client ID* : le **Services ID** (ex. `com.codwsap.web`)
- *Secret Key* : contenu du fichier `.p8`
- *Team ID*, *Key ID*

Supabase génère et renouvelle lui-même le JWT client requis par Apple (celui-ci
expire au maximum tous les 6 mois).

Vérifiez que `https://<votre-domaine>/auth/callback` figure dans
**Redirect URLs**.

## 4. Activer le bouton dans l'application

Dans `src/components/auth/social.tsx`, remplacez le bouton Apple désactivé par
un bouton actif appelant :

```ts
await supabase.auth.signInWithOAuth({
  provider: "apple",
  options: { redirectTo: `${window.location.origin}/auth/callback` },
});
```

Aucune autre modification n'est nécessaire : le callback, la liaison
d'identités et l'onboarding sont communs à tous les fournisseurs.

## 5. Particularités d'Apple à connaître

- **Adresse email masquée.** Les utilisateurs peuvent choisir « Masquer mon
  adresse » ; Apple fournit alors un alias `@privaterelay.appleid.com`, qui
  relaie bien les emails. Cet alias est stable pour un utilisateur donné, mais
  **différent** de son adresse réelle : si la personne s'était inscrite par mot
  de passe, la liaison automatique ne se fera pas et un second compte sera
  créé. C'est un comportement inhérent à Apple, pas un défaut de CODWSAP.
- **Le nom n'est transmis qu'à la toute première connexion.** Notre onboarding
  demande le nom explicitement, donc ce point ne pose pas de problème ici.
- Apple exige que son bouton respecte ses règles de présentation
  ([Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)).

## 6. Vérification

Après activation, testez : première connexion → `/bienvenue` → `/dashboard` ;
seconde connexion → `/dashboard`. Vérifiez qu'aucun marchand en double n'a été
créé.
