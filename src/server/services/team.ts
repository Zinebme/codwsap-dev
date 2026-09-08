import "server-only";
import crypto from "node:crypto";
import { all, get, run, tx, uid, nowIso } from "@/server/db";
import { hashPassword, verifyPassword, HttpError } from "@/server/auth/session";
import { audit } from "@/server/services/audit";
import { randomToken } from "@/server/crypto";
import type { Role } from "@/lib/domain";

/**
 * Gestion d'équipe : invitations par lien à usage unique, rôles, retrait.
 *
 * PRINCIPE DE SÉCURITÉ
 * --------------------
 * Le lien d'invitation est affiché à l'invitant (il le transmet par email ou
 * WhatsApp — aucun fournisseur email n'est requis). L'invitant peut donc être
 * malveillant : l'acceptation ne doit JAMAIS lui permettre de prendre le
 * contrôle d'un compte existant. Règles :
 *
 *   - compte inexistant        -> l'invité crée son mot de passe (compte neuf,
 *                                 sans marchand : aucun privilège hérité) ;
 *   - compte avec mot de passe -> le mot de passe du compte est exigé, ou une
 *                                 session déjà ouverte sur CE compte ;
 *   - compte social sans mot de passe -> session déjà ouverte exigée (Google/
 *                                 Apple prouvent l'identité, pas le lien).
 *
 * Le jeton brut n'est jamais stocké : seul son condensat SHA-256 l'est.
 */

export const INVITATION_TTL_DAYS = 7;

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Même politique que la jauge client (components/auth/social) : >= 8 car. et 2 familles. */
export function passwordAcceptable(pw: string): boolean {
  if (pw.length < 8 || pw.length > 200) return false;
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/\d/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  return variety >= 2;
}

export type PendingInvitation = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  expires_at: string;
  created_at: string;
};

export async function pendingInvitations(merchantId: string): Promise<PendingInvitation[]> {
  return await all<PendingInvitation>(
    `SELECT id, email, full_name, role, expires_at, created_at
     FROM team_invitations WHERE merchant_id = ? AND status = 'pending' ORDER BY created_at DESC`,
    [merchantId],
  );
}

export async function teamPlanLimit(merchantId: string): Promise<number | null> {
  const merchant = await get<{ plan_code: string }>("SELECT plan_code FROM merchants WHERE id = ?", [merchantId]);
  if (!merchant) return null;
  const plan = await get<{ max_team_members: number }>("SELECT max_team_members FROM plans WHERE code = ?", [merchant.plan_code]);
  return plan?.max_team_members ?? null;
}

export async function activeMemberCount(merchantId: string): Promise<number> {
  const row = await get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM merchant_users WHERE merchant_id = ? AND status = 'active'",
    [merchantId],
  );
  return Number(row?.c ?? 0);
}

/**
 * Crée une invitation (et révoque toute invitation encore en attente pour ce
 * couple boutique/email : « renvoyer » = recréer, l'ancien lien meurt).
 * La limite de plan compte les membres actifs ET les invitations en attente,
 * pour éviter de stocker des places au-delà du plan.
 */
export async function createInvitation(params: {
  merchantId: string;
  actorId: string;
  actorLabel: string;
  email: string;
  role: "admin" | "agent";
  fullName?: string | null;
  ip?: string | null;
}): Promise<{ token: string; invitation: PendingInvitation }> {
  const email = params.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new HttpError(422, "Adresse email invalide.", "validation");
  }

  const existingUser = await get<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]);
  if (existingUser) {
    const member = await get<{ id: string }>(
      "SELECT id FROM merchant_users WHERE merchant_id = ? AND user_id = ? AND status = 'active'",
      [params.merchantId, existingUser.id],
    );
    if (member) throw new HttpError(409, "Cet utilisateur fait déjà partie de votre équipe.", "conflict");
  }

  const max = await teamPlanLimit(params.merchantId);
  if (max != null) {
    const active = await activeMemberCount(params.merchantId);
    const pending = await get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM team_invitations WHERE merchant_id = ? AND status = 'pending'",
      [params.merchantId],
    );
    if (active + Number(pending?.c ?? 0) >= max) {
      throw new HttpError(403, `Votre plan est limité à ${max} membres. Passez à un plan supérieur.`, "plan_limit");
    }
  }

  // Une seule invitation en attente par email : les précédentes sont révoquées.
  await run(
    "UPDATE team_invitations SET status = 'revoked' WHERE merchant_id = ? AND email = ? AND status = 'pending'",
    [params.merchantId, email],
  );

  const token = randomToken(24);
  const id = uid("inv");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  await run(
    `INSERT INTO team_invitations (id, merchant_id, email, full_name, role, token_hash, status, invited_by, expires_at)
     VALUES (?,?,?,?,?,?, 'pending', ?, ?)`,
    [id, params.merchantId, email, params.fullName?.trim() || null, params.role, sha256Hex(token), params.actorId, expiresAt],
  );
  await audit({
    merchantId: params.merchantId,
    actorId: params.actorId,
    actorLabel: params.actorLabel,
    action: "team.invited",
    resource: "invitation",
    resourceId: id,
    ip: params.ip,
    metadata: { email, role: params.role },
  });

  const invitation = (await get<PendingInvitation>(
    "SELECT id, email, full_name, role, expires_at, created_at FROM team_invitations WHERE id = ?",
    [id],
  ))!;
  return { token, invitation };
}

export async function revokeInvitation(params: {
  merchantId: string;
  invitationId: string;
  actorId: string;
  actorLabel: string;
  ip?: string | null;
}): Promise<void> {
  const invitation = await get<{ id: string; status: string }>(
    "SELECT id, status FROM team_invitations WHERE id = ? AND merchant_id = ?",
    [params.invitationId, params.merchantId],
  );
  if (!invitation) throw new HttpError(404, "Invitation introuvable.", "not_found");
  if (invitation.status !== "pending") throw new HttpError(409, "Cette invitation n'est plus en attente.", "conflict");
  await run("UPDATE team_invitations SET status = 'revoked' WHERE id = ?", [params.invitationId]);
  await audit({
    merchantId: params.merchantId,
    actorId: params.actorId,
    actorLabel: params.actorLabel,
    action: "team.invitation_revoked",
    resource: "invitation",
    resourceId: params.invitationId,
    ip: params.ip,
  });
}

export type InvitationPreview = {
  status: "pending" | "accepted" | "revoked" | "expired" | "invalid";
  email: string;
  merchantName: string;
  merchantId: string;
  role: string;
  full_name: string | null;
  expires_at: string | null;
  /** Un compte CODWSAP existe déjà pour cet email (l'invité devra prouver son identité). */
  existingAccount: boolean;
};

/** Aperçu public d'une invitation : le jeton EST la capacité, on ne révèle que le nécessaire. */
export async function invitationPreview(token: string): Promise<InvitationPreview> {
  if (!token || token.length > 200) {
    return { status: "invalid", email: "", merchantName: "", merchantId: "", role: "agent", full_name: null, expires_at: null, existingAccount: false };
  }
  const row = await get<{
    id: string; merchant_id: string; email: string; full_name: string | null; role: string;
    status: string; expires_at: string; merchant_name: string;
  }>(
    `SELECT ti.id, ti.merchant_id, ti.email, ti.full_name, ti.role, ti.status, ti.expires_at, m.name AS merchant_name
     FROM team_invitations ti JOIN merchants m ON m.id = ti.merchant_id
     WHERE ti.token_hash = ?`,
    [sha256Hex(token)],
  );
  if (!row) {
    return { status: "invalid", email: "", merchantName: "", merchantId: "", role: "agent", full_name: null, expires_at: null, existingAccount: false };
  }
  const expired = row.status === "pending" && row.expires_at <= nowIso();
  const user = await get<{ id: string }>("SELECT id FROM users WHERE email = ?", [row.email]);
  return {
    status: expired ? "expired" : (row.status as InvitationPreview["status"]),
    email: row.email,
    merchantName: row.merchant_name,
    merchantId: row.merchant_id,
    role: row.role,
    full_name: row.full_name,
    expires_at: row.expires_at,
    existingAccount: !!user,
  };
}

/**
 * Accepte une invitation : crée le compte si besoin (mot de passe choisi par
 * l'invité), prouve l'identité si le compte existe, puis crée l'appartenance.
 * Atomique : aucune écriture partielle ne survit à un échec.
 */
export async function acceptInvitation(params: {
  token: string;
  password?: string;
  fullName?: string;
  currentUserId?: string | null;
  ip?: string | null;
}): Promise<{ userId: string; merchantId: string; merchantName: string; role: Role }> {
  const preview = await invitationPreview(params.token);
  if (preview.status === "invalid") throw new HttpError(404, "Invitation introuvable.", "not_found");
  if (preview.status === "expired") throw new HttpError(410, "Cette invitation a expiré. Demandez un nouveau lien.", "expired");
  if (preview.status === "revoked") throw new HttpError(410, "Cette invitation a été annulée.", "revoked");
  if (preview.status === "accepted") throw new HttpError(410, "Cette invitation a déjà été utilisée.", "used");

  return await tx(async () => {
    const invitation = await get<{
      id: string; merchant_id: string; email: string; full_name: string | null; role: string;
    }>(
      "SELECT id, merchant_id, email, full_name, role FROM team_invitations WHERE token_hash = ? AND status = 'pending'",
      [sha256Hex(params.token)],
    );
    if (!invitation) throw new HttpError(404, "Invitation introuvable ou déjà utilisée.", "not_found");

    // Limite de plan revérifiée à l'acceptation (le plan a pu changer depuis l'invitation).
    const max = await teamPlanLimit(invitation.merchant_id);
    if (max != null) {
      const active = await activeMemberCount(invitation.merchant_id);
      if (active >= max) {
        throw new HttpError(403, `L'équipe de cette boutique est complète (${max} membres). Contactez son propriétaire.`, "plan_limit");
      }
    }

    let user = await get<{ id: string; password_hash: string | null; full_name: string }>(
      "SELECT id, password_hash, full_name FROM users WHERE email = ?",
      [invitation.email],
    );

    if (!user) {
      // Nouveau compte : l'invité choisit son mot de passe. Aucun marchand n'est
      // créé ici — l'appartenance vient uniquement de l'invitation.
      const fullName = (params.fullName ?? invitation.full_name ?? "").trim();
      if (fullName.length < 2 || fullName.length > 80) {
        throw new HttpError(422, "Indiquez votre nom complet.", "validation");
      }
      const password = params.password ?? "";
      if (!passwordAcceptable(password)) {
        throw new HttpError(422, "Mot de passe trop faible : 8 caractères minimum et au moins deux familles (lettres, chiffres, symboles).", "weak_password");
      }
      const id = uid("usr");
      await run("INSERT INTO users (id, email, password_hash, full_name, last_login_at) VALUES (?,?,?,?,?)", [
        id,
        invitation.email,
        await hashPassword(password),
        fullName,
        nowIso(),
      ]);
      user = { id, password_hash: null, full_name: fullName };
    } else if (user.password_hash) {
      // Compte existant protégé par mot de passe : le prouver, ou être déjà
      // connecté sur CE compte. Un invitant malveillant ne connaît pas le mot
      // de passe : il ne peut pas prendre le contrôle.
      const authenticated = params.currentUserId === user.id;
      if (!authenticated) {
        if (!params.password || !(await verifyPassword(params.password, user.password_hash))) {
          throw new HttpError(401, "Ce compte existe déjà : saisissez son mot de passe pour confirmer votre identité.", "identity_required");
        }
      }
    } else if (params.currentUserId !== user.id) {
      // Compte social sans mot de passe : seule une session déjà ouverte prouve
      // l'identité (le lien d'invitation, visible de l'invitant, ne suffit pas).
      throw new HttpError(401, "Un compte existe déjà avec cet email via Google/Apple. Connectez-vous avec ce compte, puis rouvrez le lien d'invitation.", "login_required");
    }

    // Appartenance : rejointe ou réactivée (un membre désactivé peut être réinvité).
    const existing = await get<{ id: string; status: string }>(
      "SELECT id, status FROM merchant_users WHERE merchant_id = ? AND user_id = ?",
      [invitation.merchant_id, user.id],
    );
    if (existing?.status === "active") {
      throw new HttpError(409, "Vous faites déjà partie de cette équipe.", "conflict");
    }
    if (existing) {
      await run("UPDATE merchant_users SET role = ?, status = 'active', invited_email = ? WHERE id = ?", [
        invitation.role,
        invitation.email,
        existing.id,
      ]);
    } else {
      await run("INSERT INTO merchant_users (id, merchant_id, user_id, role, status, invited_email) VALUES (?,?,?,?, 'active', ?)", [
        uid("mus"),
        invitation.merchant_id,
        user.id,
        invitation.role,
        invitation.email,
      ]);
    }

    await run("UPDATE users SET last_login_at = ? WHERE id = ?", [nowIso(), user.id]);
    await run("UPDATE team_invitations SET status = 'accepted', accepted_at = ?, accepted_user_id = ? WHERE id = ?", [
      nowIso(),
      user.id,
      invitation.id,
    ]);
    await audit({
      merchantId: invitation.merchant_id,
      actorId: user.id,
      actorLabel: invitation.email,
      action: "team.invitation_accepted",
      resource: "invitation",
      resourceId: invitation.id,
      ip: params.ip,
      metadata: { role: invitation.role },
    });

    return {
      userId: user.id,
      merchantId: invitation.merchant_id,
      merchantName: (await get<{ name: string }>("SELECT name FROM merchants WHERE id = ?", [invitation.merchant_id]))!.name,
      role: invitation.role as Role,
    };
  });
}

/** Retire un membre de l'équipe. Son compte utilisateur est conservé. */
export async function removeMember(params: {
  merchantId: string;
  membershipId: string;
  actorId: string;
  actorLabel: string;
  ip?: string | null;
}): Promise<void> {
  const member = await get<{ id: string; user_id: string; role: string; status: string }>(
    "SELECT id, user_id, role, status FROM merchant_users WHERE id = ? AND merchant_id = ?",
    [params.membershipId, params.merchantId],
  );
  if (!member) throw new HttpError(404, "Membre introuvable.", "not_found");
  if (member.role === "owner") throw new HttpError(403, "Le propriétaire ne peut pas être retiré.", "forbidden");
  await run("DELETE FROM merchant_users WHERE id = ?", [params.membershipId]);
  await audit({
    merchantId: params.merchantId,
    actorId: params.actorId,
    actorLabel: params.actorLabel,
    action: "team.member_removed",
    resource: "user",
    resourceId: member.user_id,
    ip: params.ip,
    metadata: { role: member.role, previous_status: member.status },
  });
}
