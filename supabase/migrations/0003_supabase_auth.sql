-- CODWSAP — liaison entre Supabase Auth et le modèle CODWSAP.
--
-- PRINCIPE
-- --------
-- Supabase Auth gère UNIQUEMENT l'identité (mot de passe, vérification email,
-- OAuth Google/Apple, réinitialisation). La base CODWSAP reste la source de
-- vérité pour : users, merchants, merchant_users, rôles OWNER/ADMIN/AGENT,
-- subscriptions, plans, permissions, super admin et statut marchand.
--
-- On n'ajoute donc PAS de colonnes métier ici : seulement le pont d'identité.
--
-- Migration additive : aucune migration déjà appliquée n'est modifiée.

-- 1) Pont entre auth.users.id (UUID Supabase) et users.id (identifiant CODWSAP).
--    Table séparée plutôt qu'une colonne, car un même compte CODWSAP peut être
--    atteint par PLUSIEURS identités (email/password, Google, Apple) : c'est
--    exactement ce qui empêche la création de comptes/marchands en double.
CREATE TABLE IF NOT EXISTS auth_identities (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- UUID du compte Supabase Auth.
  supabase_user_id text NOT NULL,
  -- email | google | apple
  provider text NOT NULL,
  -- Email vérifié au moment de la liaison (traçabilité de la fusion d'identités).
  email text NOT NULL,
  created_at text NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  last_login_at text,
  UNIQUE (supabase_user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_supabase ON auth_identities(supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_email ON auth_identities(email);

-- 2) Les comptes créés via Google/Apple n'ont pas de mot de passe local.
--    password_hash était NOT NULL : on l'assouplit, l'authentification étant
--    désormais déléguée à Supabase Auth.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 3) Un utilisateur social n'a pas encore de marchand tant que l'onboarding
--    court n'est pas terminé. Ce drapeau distingue « inscription en cours »
--    de « compte incomplet », sans jamais créer de marchand partiel.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_pending integer NOT NULL DEFAULT 0;

-- 4) RLS : mêmes règles que les autres tables portant des données personnelles.
--    Un utilisateur ne voit que ses propres identités ; les super admins voient
--    tout (support). Le rôle applicatif (propriétaire) n'est pas soumis à la
--    RLS et reste protégé par le filtrage applicatif, comme documenté.
ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_access ON auth_identities;
CREATE POLICY self_access ON auth_identities
  USING (user_id = app_current_user_id() OR app_is_super_admin())
  WITH CHECK (user_id = app_current_user_id() OR app_is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_identities TO codwsap_tenant;
