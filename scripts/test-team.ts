/**
 * Tests de la gestion d'équipe : invitations, rôles, retrait.
 *
 *   npm run test:team
 *
 * Tourne sur un VRAI PostgreSQL (binaires embarqués) avec les migrations
 * réelles, y compris 0004_team_invitations.sql.
 *
 * CE QUI EST TESTÉ (hors ligne) :
 *   - le jeton d'invitation n'est JAMAIS stocké en clair (condensat SHA-256) ;
 *   - réinviter révoque l'invitation précédente (ancien lien mort) ;
 *   - l'acceptation crée le compte + l'appartenance de façon atomique ;
 *   - un jeton n'est utilisable qu'UNE fois ;
 *   - un compte existant protégé par mot de passe ne peut PAS être rejoint par
 *     un invitant malveillant : le mot de passe du compte est exigé ;
 *   - un compte social (sans mot de passe local) exige une session déjà
 *     ouverte sur CE compte — le lien d'invitation ne suffit pas ;
 *   - les invitations expirées et révoquées sont refusées ;
 *   - la limite de plan est appliquée à la création ET à l'acceptation ;
 *   - le retrait conserve le compte utilisateur, le propriétaire est protégé ;
 *   - un membre désactivé perd l'accès au tenant, une réinvitation le réactive ;
 *   - chaque action laisse une trace d'audit.
 *
 * CE QUI N'EST PAS TESTÉ ICI : le parcours navigateur complet (couvert par la
 * suite d'isolation HTTP) — aucune livraison email n'est requise par
 * conception : le lien d'invitation est copié par l'invitant.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { startLocalPg, localUrl } from "./pg-local";

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function expectRefused(p: Promise<unknown>, label: string, code: string) {
  try {
    await p;
    record(label, false, "(aucune erreur levée)");
  } catch (e) {
    const err = e as { code?: string; message?: string };
    record(label, err.code === code, `code=${err.code ?? "?"} (${err.message?.slice(0, 60) ?? ""})`);
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isoMinusSeconds(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

async function main() {
  console.log("\n── Préparation (PostgreSQL réel + migrations) ──────────────");
  const pg = await startLocalPg();
  const url = localUrl();
  process.env.DATABASE_URL = url;
  process.env.DB_DRIVER = "postgres";
  process.env.PGSSL = "disable";
  execSync("npx tsx scripts/migrate.ts", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
  console.log("  base prête\n");

  // Import APRÈS avoir fixé DATABASE_URL : la couche d'accès lit l'env au chargement.
  const { get, run, uid } = await import("../src/server/db");
  const { hashPassword, membershipsFor } = await import("../src/server/auth/session");
  const {
    createInvitation,
    revokeInvitation,
    invitationPreview,
    acceptInvitation,
    removeMember,
    pendingInvitations,
    activeMemberCount,
    INVITATION_TTL_DAYS,
  } = await import("../src/server/services/team");

  await run(
    "TRUNCATE users, merchants, merchant_users, subscriptions, auth_identities, team_invitations, audit_logs RESTART IDENTITY CASCADE",
    [],
  );

  // Fixtures : marchand principal au plan PRO (15 membres) pour les tests de
  // comportement ; un second marchand au plan TRIAL (2 membres) servira aux
  // tests de limite. Les plans sont semés par la migration 0001.
  const merchantId = "mch_team_test";
  const planMerchant = "mch_plan_test";
  const ownerId = "usr_owner";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [
    merchantId,
    "Boutique Test",
    "boutique-test",
    "trial",
  ]);
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'trial')", [
    planMerchant,
    "Plan Test",
    "plan-test",
    "trial",
  ]);
  await run("INSERT INTO users (id, email, password_hash, full_name) VALUES (?,?,?,?)", [
    ownerId,
    "owner@test.dz",
    await hashPassword("Owner-Pass-2026"),
    "Owner Test",
  ]);
  await run("INSERT INTO merchant_users (id, merchant_id, user_id, role, status, invited_email) VALUES (?,?,?, 'owner', 'active', ?)", [
    uid("mus"),
    merchantId,
    ownerId,
    "owner@test.dz",
  ]);
  const invite = (over: Partial<Parameters<typeof createInvitation>[0]> = {}) => ({
    merchantId,
    actorId: ownerId,
    actorLabel: "owner@test.dz",
    email: "agent@test.dz",
    role: "agent" as const,
    ip: "127.0.0.1",
    ...over,
  });

  console.log("── Création d'invitation ──────────────────────────────────");

  const { token, invitation } = await createInvitation(invite({ fullName: "Agent Test" }));
  const stored = await get<{ token_hash: string; status: string; expires_at: string; full_name: string }>(
    "SELECT token_hash, status, expires_at, full_name FROM team_invitations WHERE id = ?",
    [invitation.id],
  );
  record(
    "Le jeton brut n'est pas stocké (condensat SHA-256)",
    stored?.token_hash === sha256Hex(token) && stored.token_hash !== token,
  );
  record("Invitation en attente avec rôle et nom", stored?.status === "pending" && stored?.full_name === "Agent Test");

  const days = stored ? (Date.parse(stored.expires_at.replace(" ", "T") + "Z") - Date.now()) / 86_400_000 : 0;
  record("Expiration à ~7 jours", days > INVITATION_TTL_DAYS - 0.1 && days <= INVITATION_TTL_DAYS, `${days.toFixed(2)} j`);

  const preview = await invitationPreview(token);
  record(
    "Aperçu public : boutique, email, pas de compte existant",
    preview.status === "pending" && preview.merchantName === "Boutique Test" && preview.email === "agent@test.dz" && preview.existingAccount === false,
  );
  record("Jeton inconnu -> invalide", (await invitationPreview("totalement-inconnu")).status === "invalid");

  console.log("\n── Réinvitation : l'ancien lien meurt ──────────────────────");
  const { token: token2 } = await createInvitation(invite());
  record("Réinviter révoque la précédente", (await invitationPreview(token)).status === "revoked");
  record("Le nouveau jeton est différent", token2 !== token);
  record("Une seule invitation en attente par email", (await pendingInvitations(merchantId)).length === 1);

  console.log("\n── Acceptation : nouveau compte ───────────────────────────");
  await expectRefused(
    acceptInvitation({ token: token2, fullName: "Agent Test", password: "faible" }),
    "Mot de passe trop faible refusé",
    "weak_password",
  );
  const noGhost = await get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE email = ?", ["agent@test.dz"]);
  record("Aucun compte créé lors du refus", Number(noGhost?.c) === 0);

  const accepted = await acceptInvitation({ token: token2, fullName: "Agent Test", password: "Agent-Pass-2026", ip: "127.0.0.1" });
  record("Acceptation réussie", accepted.merchantId === merchantId && accepted.role === "agent");
  const agentUser = await get<{ id: string; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE email = ?",
    ["agent@test.dz"],
  );
  record("Compte créé avec mot de passe haché (bcrypt)", !!agentUser?.password_hash && agentUser.password_hash.startsWith("$2"));
  record(
    "Appartenance active avec le rôle invité",
    !!(await get("SELECT id FROM merchant_users WHERE merchant_id = ? AND user_id = ? AND role = 'agent' AND status = 'active'", [merchantId, agentUser!.id])),
  );
  record("Dernière connexion renseignée", !!(await get("SELECT id FROM users WHERE id = ? AND last_login_at IS NOT NULL", [agentUser!.id])));
  await expectRefused(acceptInvitation({ token: token2, password: "Agent-Pass-2026" }), "Jeton à usage unique : seconde acceptation refusée", "used");
  const memberships = await membershipsFor(agentUser!.id);
  record("Le membre voit sa boutique via membershipsFor", memberships.length === 1 && memberships[0].merchant_id === merchantId);

  console.log("\n── Acceptation : compte existant protégé par mot de passe ──");
  // L'invitant (malveillant) détient le lien : il ne doit PAS pouvoir accéder à
  // un compte existant sans en connaître le mot de passe.
  await run("INSERT INTO users (id, email, password_hash, full_name) VALUES (?,?,?,?)", [
    "usr_existing",
    "existing@test.dz",
    await hashPassword("Existing-Pass-2026"),
    "Existing User",
  ]);
  const { token: tokExisting } = await createInvitation(invite({ email: "existing@test.dz", role: "admin" }));
  await expectRefused(acceptInvitation({ token: tokExisting }), "Sans mot de passe : refus", "identity_required");
  await expectRefused(acceptInvitation({ token: tokExisting, password: "Mauvais-Mot-Passe" }), "Mauvais mot de passe : refus", "identity_required");
  const acceptedExisting = await acceptInvitation({ token: tokExisting, password: "Existing-Pass-2026" });
  record("Bon mot de passe : acceptation et rôle admin", acceptedExisting.role === "admin");
  // Session déjà ouverte sur le bon compte : accepté sans retaper le mot de passe.
  await run("INSERT INTO users (id, email, password_hash, full_name) VALUES (?,?,?,?)", [
    "usr_logged",
    "logged@test.dz",
    await hashPassword("Logged-Pass-2026"),
    "Logged User",
  ]);
  const { token: tokLogged } = await createInvitation(invite({ email: "logged@test.dz" }));
  const acceptedLogged = await acceptInvitation({ token: tokLogged, currentUserId: "usr_logged" });
  record("Session déjà ouverte sur ce compte : accepté sans mot de passe", acceptedLogged.userId === "usr_logged");

  console.log("\n── Acceptation : compte social sans mot de passe ──────────");
  const socialId = "usr_social";
  await run("INSERT INTO users (id, email, password_hash, full_name) VALUES (?,?,NULL,?)", [socialId, "social@test.dz", "Social User"]);
  const { token: tokSocial } = await createInvitation(invite({ email: "social@test.dz" }));
  await expectRefused(
    acceptInvitation({ token: tokSocial, password: "Nouveau-Mot-Passe-1" }),
    "Définir un mot de passe sans session : refus",
    "login_required",
  );
  const unchanged = await get<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id = ?", [socialId]);
  record("Aucun mot de passe injecté sur le compte social", unchanged?.password_hash === null);
  const socialAccept = await acceptInvitation({ token: tokSocial, currentUserId: socialId, fullName: "Social User" });
  record("Session déjà ouverte sur le bon compte : acceptation OK", socialAccept.userId === socialId);
  record("Toujours aucun mot de passe local après acceptation", (await get("SELECT password_hash FROM users WHERE id = ?", [socialId]))?.password_hash === null);

  console.log("\n── Invitations expirée et révoquée ────────────────────────");
  const { token: tokExpiry } = await createInvitation(invite({ email: "expire@test.dz" }));
  await run("UPDATE team_invitations SET expires_at = ? WHERE token_hash = ?", [isoMinusSeconds(10), sha256Hex(tokExpiry)]);
  record("Aperçu d'une invitation expirée", (await invitationPreview(tokExpiry)).status === "expired");
  await expectRefused(acceptInvitation({ token: tokExpiry, fullName: "Ex Pire", password: "Expired-Pass-1" }), "Acceptation expirée refusée", "expired");
  record("Aucun compte créé depuis le lien expiré", Number((await get("SELECT COUNT(*) AS c FROM users WHERE email = ?", ["expire@test.dz"]))?.c) === 0);

  const revoked = await createInvitation(invite({ email: "revoque@test.dz" }));
  await revokeInvitation({ merchantId, invitationId: revoked.invitation.id, actorId: ownerId, actorLabel: "owner@test.dz" });
  await expectRefused(
    acceptInvitation({ token: revoked.token, fullName: "Revo Que", password: "Revoked-Pass-1" }),
    "Acceptation d'une invitation révoquée refusée",
    "revoked",
  );
  await expectRefused(
    revokeInvitation({ merchantId, invitationId: revoked.invitation.id, actorId: ownerId, actorLabel: "owner@test.dz" }),
    "Révoquer deux fois la même invitation refusé",
    "conflict",
  );

  console.log("\n── Limite de plan (trial : 2 membres) ─────────────────────");
  // Marchand TRIAL : 1 actif (l'agent), 1 invitation -> 1 + 0 = 1 < 2 : OK.
  await run("INSERT INTO merchant_users (id, merchant_id, user_id, role, status) VALUES (?,?,?, 'agent', 'active')", [
    uid("mus"),
    planMerchant,
    agentUser!.id,
  ]);
  const planInvite = await createInvitation({
    merchantId: planMerchant,
    actorId: ownerId,
    actorLabel: "owner@test.dz",
    email: "plan@test.dz",
    role: "agent",
  });
  record("Sous la limite : invitation créée", (await pendingInvitations(planMerchant)).length === 1);
  // On complète l'équipe entre-temps : l'acceptation doit être refusée.
  await run("INSERT INTO merchant_users (id, merchant_id, user_id, role, status) VALUES (?,?,?, 'agent', 'active')", [
    uid("mus"),
    planMerchant,
    socialId,
  ]);
  await expectRefused(
    acceptInvitation({ token: planInvite.token, fullName: "Plan Test", password: "Plan-Pass-2026" }),
    "Acceptation refusée quand l'équipe est complète",
    "plan_limit",
  );
  const stillPending = await get<{ status: string }>("SELECT status FROM team_invitations WHERE token_hash = ?", [sha256Hex(planInvite.token)]);
  record("L'invitation refusée reste en attente", stillPending?.status === "pending");
  // Un membre actif retiré : la place se libère, l'acceptation passe.
  const socialPlanMembership = await get<{ id: string }>("SELECT id FROM merchant_users WHERE merchant_id = ? AND user_id = ?", [planMerchant, socialId]);
  await removeMember({ merchantId: planMerchant, membershipId: socialPlanMembership!.id, actorId: ownerId, actorLabel: "owner@test.dz" });
  const planAccepted = await acceptInvitation({ token: planInvite.token, fullName: "Plan Test", password: "Plan-Pass-2026" });
  record("Place libérée : l'invitation devient acceptable", planAccepted.merchantId === planMerchant);
  // Équipe complète (2 actifs) : nouvelle invitation refusée à la création.
  await expectRefused(
    createInvitation({ merchantId: planMerchant, actorId: ownerId, actorLabel: "owner@test.dz", email: "extra@test.dz", role: "agent" }),
    "Invitation refusée au-delà du plan",
    "plan_limit",
  );

  console.log("\n── Retrait de membre et protection du propriétaire ────────");
  const ownerMembership = await get<{ id: string }>("SELECT id FROM merchant_users WHERE merchant_id = ? AND role = 'owner'", [merchantId]);
  await expectRefused(
    removeMember({ merchantId, membershipId: ownerMembership!.id, actorId: ownerId, actorLabel: "owner@test.dz" }),
    "Le propriétaire ne peut pas être retiré",
    "forbidden",
  );
  const socialMembership = await get<{ id: string }>("SELECT id FROM merchant_users WHERE merchant_id = ? AND user_id = ?", [merchantId, socialId]);
  await removeMember({ merchantId, membershipId: socialMembership!.id, actorId: ownerId, actorLabel: "owner@test.dz" });
  record("Retrait effectif : appartenance supprimée", !(await get("SELECT id FROM merchant_users WHERE id = ?", [socialMembership!.id])));
  record("Le compte utilisateur est conservé", !!(await get("SELECT id FROM users WHERE id = ?", [socialId])));
  record("Le membre retiré ne voit plus la boutique", (await membershipsFor(socialId)).length === 0);
  await expectRefused(
    removeMember({ merchantId, membershipId: "mus_inexistant", actorId: ownerId, actorLabel: "owner@test.dz" }),
    "Retrait d'un membre d'une autre boutique : introuvable",
    "not_found",
  );

  console.log("\n── Membre désactivé puis réinvité ─────────────────────────");
  const agentMembership = await get<{ id: string }>("SELECT id FROM merchant_users WHERE merchant_id = ? AND user_id = ?", [merchantId, agentUser!.id]);
  await run("UPDATE merchant_users SET status = 'disabled' WHERE id = ?", [agentMembership!.id]);
  // L'agent reste membre du second marchand de test : on vérifie juste qu'il
  // ne voit PLUS celui-ci (les appartenance actives filtrent par statut).
  const afterDisable = await membershipsFor(agentUser!.id);
  record("Membre désactivé : plus d'accès tenant", !afterDisable.some((m) => m.merchant_id === merchantId));
  const { token: tokRejoin } = await createInvitation(invite({ email: "agent@test.dz" }));
  const rejoin = await acceptInvitation({ token: tokRejoin, password: "Agent-Pass-2026" });
  record("Réinvitation d'un membre désactivé : réactivé", rejoin.userId === agentUser!.id);
  record(
    "Une seule appartenance, active",
    Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM merchant_users WHERE merchant_id = ? AND user_id = ?", [merchantId, agentUser!.id]))?.c) === 1 &&
      !!(await get("SELECT id FROM merchant_users WHERE merchant_id = ? AND user_id = ? AND status = 'active'", [merchantId, agentUser!.id])),
  );

  console.log("\n── Piste d'audit ──────────────────────────────────────────");
  const actions = await get<{ invited: number; accepted: number; removed: number }>(
    `SELECT
       SUM(CASE WHEN action = 'team.invited' THEN 1 ELSE 0 END) AS invited,
       SUM(CASE WHEN action = 'team.invitation_accepted' THEN 1 ELSE 0 END) AS accepted,
       SUM(CASE WHEN action = 'team.member_removed' THEN 1 ELSE 0 END) AS removed
     FROM audit_logs WHERE merchant_id = ?`,
    [merchantId],
  );
  record(
    "Actions d'équipe journalisées",
    Number(actions?.invited ?? 0) >= 8 && Number(actions?.accepted ?? 0) >= 4 && Number(actions?.removed ?? 0) === 1,
    `invited=${actions?.invited} accepted=${actions?.accepted} removed=${actions?.removed}`,
  );
  record("Comptage des membres actifs", (await activeMemberCount(merchantId)) === 4, `${await activeMemberCount(merchantId)} (owner, agent, existing, logged)`);


  console.log("\n── Résultat ────────────────────────────────────────────────");
  const passed = results.filter((r) => r.ok).length;
  console.log(`  ${passed}/${results.length} tests réussis\n`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  ÉCHEC: ${r.name} ${r.detail}`);

  const { closeDb } = await import("../src/server/db");
  await closeDb();
  await pg.stop();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
