-- CODWSAP — invitations d'équipe (lien à usage unique).
--
-- PRINCIPE
-- --------
-- Complète merchant_users : un propriétaire/admin invite un membre par email,
-- l'invité définit lui-même son mot de passe via un lien à usage unique
-- (valable 7 jours). Le lien peut être transmis manuellement (email,
-- WhatsApp) : aucun fournisseur email n'est requis.
--
-- Sécurité :
--   - seul le condensat SHA-256 du jeton est stocké (jamais le jeton brut) ;
--   - un seul statut possible par jeton : pending | accepted | revoked ;
--   - l'acceptation est refusée pour un compte existant tant que
--     l'identité n'est pas prouvée (mot de passe du compte ou session
--     déjà ouverte) — un invitant malveillant ne peut donc jamais
--     prendre le contrôle d'un compte existant.
--
-- Migration additive : aucune migration déjà appliquée n'est modifiée.

CREATE TABLE IF NOT EXISTS team_invitations (
  id text PRIMARY KEY,
  merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'agent', -- admin | agent
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | revoked
  invited_by text REFERENCES users(id) ON DELETE SET NULL,
  expires_at text NOT NULL,
  created_at text NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH:MI:SS')),
  accepted_at text,
  accepted_user_id text REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_team_invitations_merchant ON team_invitations(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_team_invitations_email ON team_invitations(email);

-- RLS : mêmes règles que les autres tables du tenant — un membre actif de la
-- boutique voit les invitations de SA boutique, les super admins voient tout.
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON team_invitations;
CREATE POLICY tenant_isolation ON team_invitations
  USING (app_is_member(merchant_id))
  WITH CHECK (app_is_member(merchant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON team_invitations TO codwsap_tenant;
