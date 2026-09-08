/**
 * Tests de l'authentification et de la liaison d'identités.
 *
 *   npm run test:auth
 *
 * Tourne sur un VRAI PostgreSQL (binaires embarqués) avec les migrations
 * réelles : la logique anti-doublon est vérifiée contre le schéma de
 * production, contraintes d'unicité comprises.
 *
 * CE QUI EST TESTÉ (hors ligne, sans Supabase) :
 *   - un nouvel utilisateur social est créé SANS marchand ;
 *   - la reconnexion réutilise le même compte (pas de doublon) ;
 *   - Google puis Apple sur le même email vérifié -> UN SEUL utilisateur et
 *     UN SEUL marchand (liaison d'identités) ;
 *   - un email NON vérifié ne peut jamais fusionner avec un compte existant
 *     (protection contre la prise de contrôle de compte) ;
 *   - un compte désactivé est refusé ;
 *   - l'onboarding social crée marchand + OWNER + abonnement d'essai ;
 *   - l'onboarding est idempotent (double envoi -> un seul marchand) ;
 *   - un onboarding invalide n'entraîne AUCUNE création partielle (atomicité).
 *
 * CE QUI N'EST PAS TESTÉ ICI : le dialogue réel avec Supabase Auth et les
 * fournisseurs Google/Apple, qui exige des identifiants et un domaine publics.
 * Aucun succès de ce type n'est revendiqué.
 */
import { execSync } from "node:child_process";
import { startLocalPg, localUrl } from "./pg-local";

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${detail ? ` — ${detail}` : ""}`);
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
  const { linkSupabaseIdentity, completeSocialOnboarding } = await import("../src/server/auth/identity");
  const { get, run, uid } = await import("../src/server/db");

  // La base embarquée survit d'une exécution à l'autre : on repart d'un état
  // propre, sinon les assertions « premier passage » testeraient des restes.
  await run(
    "TRUNCATE users, merchants, merchant_users, subscriptions, auth_identities, automations, whatsapp_templates RESTART IDENTITY CASCADE",
    [],
  );

  const ident = (over: Partial<Parameters<typeof linkSupabaseIdentity>[0]> = {}) => ({
    id: "sb-" + Math.random().toString(36).slice(2),
    email: "a@test.dz",
    emailVerified: true,
    fullName: "Amine Test",
    provider: "google",
    ...over,
  });

  console.log("── Première connexion sociale ──────────────────────────────");

  const googleId = "sb-google-1";
  const first = await linkSupabaseIdentity(ident({ id: googleId, email: "amine@boutique.dz" }));
  record(
    "Nouvel utilisateur social créé sans marchand",
    first.status === "created" && "hasMerchant" in first && first.hasMerchant === false,
    `statut=${first.status}`,
  );

  const userId = "userId" in first ? first.userId : "";
  const pendingUser = await get<{ onboarding_pending: number; password_hash: string | null }>(
    "SELECT onboarding_pending, password_hash FROM users WHERE id = ?",
    [userId],
  );
  record(
    "Compte social sans mot de passe local, onboarding en attente",
    Number(pendingUser?.onboarding_pending) === 1 && pendingUser?.password_hash === null,
  );

  const again = await linkSupabaseIdentity(ident({ id: googleId, email: "amine@boutique.dz" }));
  record(
    "Reconnexion : même compte réutilisé, aucun doublon",
    again.status === "linked" && "userId" in again && again.userId === userId,
  );

  const userCount = await get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE email = ?", ["amine@boutique.dz"]);
  record("Un seul utilisateur en base pour cet email", Number(userCount?.c) === 1, `n=${userCount?.c}`);

  console.log("\n── Onboarding social atomique ──────────────────────────────");

  const onb = await completeSocialOnboarding({
    userId,
    fullName: "Amine Test",
    business: "Boutique Amine",
    phoneNormalized: "+213550123456",
  });
  record("Onboarding réussi", onb.ok === true, onb.ok ? onb.merchantId : (onb as { error: string }).error);
  const merchantId = onb.ok ? onb.merchantId : "";

  const owner = await get<{ role: string; status: string }>(
    "SELECT role, status FROM merchant_users WHERE merchant_id = ? AND user_id = ?",
    [merchantId, userId],
  );
  record("Appartenance OWNER active créée", owner?.role === "owner" && owner?.status === "active");

  const sub = await get<{ status: string; plan_code: string }>(
    "SELECT status, plan_code FROM subscriptions WHERE merchant_id = ?",
    [merchantId],
  );
  record("Abonnement d'essai créé", sub?.status === "trialing" && sub?.plan_code === "trial");

  const merch = await get<{ status: string; trial_ends_at: string }>(
    "SELECT status, trial_ends_at FROM merchants WHERE id = ?",
    [merchantId],
  );
  record("Marchand en essai avec date de fin", merch?.status === "trial" && Boolean(merch?.trial_ends_at));

  const autos = await get<{ c: number }>("SELECT COUNT(*) AS c FROM automations WHERE merchant_id = ?", [merchantId]);
  record("Automatisations par défaut créées", Number(autos?.c) > 0, `n=${autos?.c}`);

  const tpls = await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ?", [
    merchantId,
  ]);
  record("Modèles WhatsApp par défaut créés", Number(tpls?.c) > 0, `n=${tpls?.c}`);

  const cleared = await get<{ onboarding_pending: number }>("SELECT onboarding_pending FROM users WHERE id = ?", [
    userId,
  ]);
  record("Drapeau d'onboarding levé", Number(cleared?.onboarding_pending) === 0);

  const twice = await completeSocialOnboarding({
    userId,
    fullName: "Amine Test",
    business: "Boutique Amine",
    phoneNormalized: "+213550123456",
  });
  const merchTotal = await get<{ c: number }>("SELECT COUNT(*) AS c FROM merchant_users WHERE user_id = ?", [userId]);
  record(
    "Onboarding idempotent : pas de second marchand",
    twice.ok === true && Number(merchTotal?.c) === 1,
    `appartenances=${merchTotal?.c}`,
  );

  console.log("\n── Liaison d'identités (anti-doublon) ──────────────────────");

  // Même personne, même email vérifié, mais fournisseur Apple cette fois.
  const apple = await linkSupabaseIdentity(
    ident({ id: "sb-apple-1", email: "amine@boutique.dz", provider: "apple", emailVerified: true }),
  );
  record(
    "Apple sur email vérifié : rattaché au compte existant",
    apple.status === "linked" && "userId" in apple && apple.userId === userId,
    `statut=${apple.status}`,
  );
  record("Apple : le marchand existant est retrouvé", "hasMerchant" in apple && apple.hasMerchant === true);

  const afterLink = await get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE email = ?", ["amine@boutique.dz"]);
  record("Toujours un seul utilisateur après liaison", Number(afterLink?.c) === 1, `n=${afterLink?.c}`);

  const merchantsForUser = await get<{ c: number }>("SELECT COUNT(*) AS c FROM merchant_users WHERE user_id = ?", [
    userId,
  ]);
  record("Aucun marchand en double après liaison", Number(merchantsForUser?.c) === 1);

  const idCount = await get<{ c: number }>("SELECT COUNT(*) AS c FROM auth_identities WHERE user_id = ?", [userId]);
  record("Deux identités rattachées au même compte", Number(idCount?.c) === 2, `n=${idCount?.c}`);

  console.log("\n── Sécurité : email non vérifié et compte désactivé ────────");

  // Un attaquant crée un compte social portant l'email d'un marchand existant,
  // sans que le fournisseur ait vérifié l'adresse.
  const attack = await linkSupabaseIdentity(
    ident({ id: "sb-attacker", email: "amine@boutique.dz", provider: "google", emailVerified: false }),
  );
  record(
    "Email non vérifié : fusion REFUSÉE (anti-usurpation)",
    attack.status === "email_unverified",
    `statut=${attack.status}`,
  );

  const stillOne = await get<{ c: number }>("SELECT COUNT(*) AS c FROM auth_identities WHERE user_id = ?", [userId]);
  record("Aucune identité ajoutée par la tentative refusée", Number(stillOne?.c) === 2);

  const newUnverified = await linkSupabaseIdentity(
    ident({ id: "sb-new-unverified", email: "inconnu@test.dz", emailVerified: false }),
  );
  record(
    "Nouvel email non vérifié : aucun compte créé",
    newUnverified.status === "email_unverified",
    `statut=${newUnverified.status}`,
  );
  const ghost = await get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE email = ?", ["inconnu@test.dz"]);
  record("Aucun compte fantôme en base", Number(ghost?.c) === 0);

  // Compte désactivé.
  const offId = uid("usr");
  await run("INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES (?,?,?,?,0)", [
    offId,
    "off@test.dz",
    null,
    "Compte désactivé",
  ]);
  const off = await linkSupabaseIdentity(ident({ id: "sb-off", email: "off@test.dz", emailVerified: true }));
  record("Compte désactivé : connexion refusée", off.status === "inactive", `statut=${off.status}`);

  console.log("\n── Atomicité de l'onboarding ───────────────────────────────");

  const orphan = await linkSupabaseIdentity(ident({ id: "sb-orphan", email: "orphan@test.dz" }));
  const orphanId = "userId" in orphan ? orphan.userId : "";
  const before = await get<{ c: number }>("SELECT COUNT(*) AS c FROM merchants", []);

  // Nom de boutique absurde -> la contrainte NOT NULL sur `name` échoue.
  const failed = await completeSocialOnboarding({
    userId: orphanId,
    fullName: "X",
    business: "",
    phoneNormalized: "+213550999999",
  });
  const after = await get<{ c: number }>("SELECT COUNT(*) AS c FROM merchants", []);
  record(
    "Échec d'onboarding : aucun marchand partiel",
    Number(before?.c) === Number(after?.c),
    `avant=${before?.c} après=${after?.c}`,
  );
  const orphanMemberships = await get<{ c: number }>("SELECT COUNT(*) AS c FROM merchant_users WHERE user_id = ?", [
    orphanId,
  ]);
  record(
    "Échec d'onboarding : aucune appartenance orpheline",
    Number(orphanMemberships?.c) === 0,
    failed.ok ? "(création acceptée)" : "",
  );

  console.log("\n── Résultat ────────────────────────────────────────────────");
  const passed = results.filter((r) => r.ok).length;
  console.log(`  ${passed}/${results.length} tests réussis\n`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  ÉCHEC: ${r.name} ${r.detail}`);

  // Fermer le pool avant d'arrêter PostgreSQL, sinon les connexions ouvertes
  // émettent une erreur non gérée à l'extinction du serveur.
  const { closeDb } = await import("../src/server/db");
  await closeDb();
  await pg.stop();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
