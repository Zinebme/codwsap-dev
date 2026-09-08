/**
 * Tests des opérations d'administration de l'infrastructure.
 *
 *   npm run test:admin-ops
 *
 * Tourne sur un VRAI PostgreSQL (binaires embarqués) avec les migrations
 * réelles. Couvre la couche service derrière la console super admin :
 *
 *   - retryJob  : une tâche en échec repart en file, tentatives remises à 0 ;
 *   - discardJob: la tâche est supprimée, les autres statuts sont protégés ;
 *   - replayWebhook : rejeu d'un webhook transporteur en échec, application
 *     idempotente (un second passage n'applique rien deux fois) ;
 *   - les sources non transporteurs ne sont pas rejouables (honnêteté) ;
 *   - le worker finalise une tâche après épuisement des tentatives et
 *     l'annonce au marchand (notification « job_failed »).
 *
 * CE QUI N'EST PAS TESTÉ ICI : les appels HTTP réels aux transporteurs et à
 * Telegram, qui exigent des identifiants — aucun succès n'est revendiqué.
 */
import { execSync } from "node:child_process";
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
    const err = e as { code?: string };
    record(label, err.code === code, `code=${err.code ?? "?"}`);
  }
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

  const { get, run, uid, nowIso } = await import("../src/server/db");
  const { enqueueJob, claimJobs } = await import("../src/server/jobs/queue");
  const { runWorker } = await import("../src/server/jobs/worker");
  const { retryJob, discardJob, replayWebhook } = await import("../src/server/services/adminOps");

  await run(
    "TRUNCATE users, merchants, merchant_users, jobs, webhook_events, notifications, delivery_connections, delivery_events, delivery_shipments, orders, audit_logs RESTART IDENTITY CASCADE",
    [],
  );

  const admin = { id: "usr_admin", email: "admin@codwsap.test" };
  const merchantId = "mch_ops_test";
  await run("INSERT INTO users (id, email, password_hash, full_name, is_super_admin) VALUES (?,?,?, ?, 1)", [
    admin.id,
    admin.email,
    // mot de passe factice : jamais utilisé ici
    "$2a$10$abcdefghijklmnopqrstuv",
    "Super Admin",
  ]);
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [merchantId, "Ops Test", "ops-test", "trial"]);

  console.log("── File de traitements : rejeu et suppression ─────────────");

  // Tâche en échec (simule un échec définitif).
  const failedJobId = await enqueueJob({ merchantId, type: "poll_delivery", maxAttempts: 1 });
  await run("UPDATE jobs SET status = 'failed', attempts = 1, last_error = 'HTTP 503' WHERE id = ?", [failedJobId]);

  await retryJob(failedJobId, admin);
  const retried = await get<{ status: string; attempts: number; run_after: string }>(
    "SELECT status, attempts, run_after FROM jobs WHERE id = ?",
    [failedJobId],
  );
  record(
    "Tâche en échec remise en file, tentatives à 0",
    retried?.status === "pending" && retried.attempts === 0 && retried.run_after <= nowIso(),
    `statut=${retried?.status} tentatives=${retried?.attempts}`,
  );

  await expectRefused(retryJob(failedJobId, admin), "Rejouer une tâche non échouée refusé", "conflict");

  // La tâche est repartie en file : on la repasse en échec pour le rejeu/suppression.
  await run("UPDATE jobs SET status = 'failed', attempts = 1, last_error = 'HTTP 503' WHERE id = ?", [failedJobId]);

  // Tâche en cours : propriété du worker, non modifiable.
  const runningJobId = await enqueueJob({ merchantId, type: "poll_delivery" });
  await run("UPDATE jobs SET status = 'running' WHERE id = ?", [runningJobId]);
  await expectRefused(retryJob(runningJobId, admin), "Rejouer une tâche en cours refusé", "conflict");
  await expectRefused(discardJob(runningJobId, admin), "Supprimer une tâche en cours refusé", "conflict");
  await expectRefused(retryJob("job_inexistant", admin), "Tâche inexistante : 404", "not_found");

  await discardJob(failedJobId, admin);
  record("Tâche en échec supprimée", !(await get("SELECT id FROM jobs WHERE id = ?", [failedJobId])));
  await expectRefused(discardJob(failedJobId, admin), "Supprimer deux fois la même tâche refusé", "not_found");

  console.log("\n── Webhook transporteur : rejeu idempotent ────────────────");

  // Connexion sandbox (aucun réseau) + commande avec numéro de suivi.
  await run(
    "INSERT INTO delivery_connections (id, merchant_id, provider, label, is_active, status) VALUES (?,?,?,?,1, 'connected')",
    [uid("dlc"), merchantId, "sandbox", "Sandbox"],
  );
  const orderId = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_name, normalized_phone, wilaya, delivery_type, products_price, delivery_price, total, status, delivery_status, tracking_number, created_at)
     VALUES (?,?,?,?,?,?, 'home', 1000, 400, 1400, 'confirmed', 'submitted', 'TEST-REF-1', ?)`,
    [orderId, merchantId, "CMD-1", "Client Test", "+213555000001", "Alger", nowIso()],
  );

  const webhookId = uid("whk");
  const payload = { tracking: "TEST-REF-1", status: "Livré", date: "2026-01-01 10:00:00" };
  await run(
    `INSERT INTO webhook_events (id, merchant_id, source, provider, idempotency_key, signature_valid, status, payload, error)
     VALUES (?,?,?,?,?, 1, 'failed', ?, 'erreur transitoire')`,
    [webhookId, merchantId, "delivery", "sandbox", `test-${webhookId}`, JSON.stringify(payload)],
  );

  const replay1 = await replayWebhook(webhookId, admin);
  record("Rejeu applique l'évènement au colis", replay1.applied === 1, `${replay1.applied} évènement(s)`);
  const order = await get<{ delivery_status: string }>("SELECT delivery_status FROM orders WHERE id = ?", [orderId]);
  record("Commande passée en « delivered »", order?.delivery_status === "delivered", `statut=${order?.delivery_status}`);
  const webhookStatus = await get<{ status: string }>("SELECT status FROM webhook_events WHERE id = ?", [webhookId]);
  record("Webhook marqué « processed »", webhookStatus?.status === "processed");

  await expectRefused(replayWebhook(webhookId, admin), "Rejouer un webhook déjà traité refusé", "conflict");

  // Idempotence : un second passage avec la MÊME charge ne réapplique rien.
  const webhookId2 = uid("whk");
  await run(
    `INSERT INTO webhook_events (id, merchant_id, source, provider, idempotency_key, signature_valid, status, payload, error)
     VALUES (?,?,?,?,?, 1, 'failed', ?, 'erreur transitoire')`,
    [webhookId2, merchantId, "delivery", "sandbox", `test-${webhookId2}`, JSON.stringify(payload)],
  );
  const replay2 = await replayWebhook(webhookId2, admin);
  record("Rejeu répété : dédupliqué, aucun double traitement", replay2.applied === 0, `${replay2.applied} évènement(s)`);
  const events = await get<{ c: number }>("SELECT COUNT(*) AS c FROM delivery_events WHERE merchant_id = ? AND order_id = ?", [merchantId, orderId]);
  record("Un seul évènement de livraison en base", Number(events?.c) === 1, `n=${events?.c}`);

  // Sources non transporteurs : honnêteté, pas de rejeu revendiqué.
  const whatsappWebhookId = uid("whk");
  await run(
    `INSERT INTO webhook_events (id, merchant_id, source, provider, idempotency_key, signature_valid, status, payload, error)
     VALUES (?,?,?,?,?, 1, 'failed', ?, 'erreur')`,
    [whatsappWebhookId, merchantId, "whatsapp", "meta_cloud", `test-${whatsappWebhookId}`, JSON.stringify({ entry: [] })],
  );
  await expectRefused(replayWebhook(whatsappWebhookId, admin), "Webhook WhatsApp : rejeu non disponible (refusé)", "not_replayable");
  await expectRefused(replayWebhook("whk_inexistant", admin), "Webhook inexistant : 404", "not_found");

  console.log("\n── Worker : échec définitif -> notification marchand ───────");

  // sync_sheet vers une intégration inexistante : échec assuré hors ligne.
  const jobCountBefore = await get<{ c: number }>("SELECT COUNT(*) AS c FROM jobs");
  const doomedJobId = await enqueueJob({ merchantId, type: "sync_sheet", payload: { integrationId: "int_inexistant" }, maxAttempts: 1 });
  await runWorker(10);
  const doomed = await get<{ status: string; attempts: number; last_error: string | null }>(
    "SELECT status, attempts, last_error FROM jobs WHERE id = ?",
    [doomedJobId],
  );
  record("Tâche irrécupérable : statut failed après tentative", doomed?.status === "failed" && doomed.attempts === 1, `erreur=${doomed?.last_error?.slice(0, 40)}`);
  const notif = await get<{ id: string; type: string; severity: string }>(
    "SELECT id, type, severity FROM notifications WHERE merchant_id = ? AND type = 'job_failed' ORDER BY created_at DESC LIMIT 1",
    [merchantId],
  );
  record("Le marchand est alerté (notification job_failed)", !!notif && notif.severity === "error");

  // Le rejeu super admin remet la tâche en file ; elle échoue à nouveau
  // proprement (même comportement, aucune boucle infinie).
  await retryJob(doomedJobId, admin);
  await runWorker(10);
  const doomed2 = await get<{ status: string; attempts: number }>("SELECT status, attempts FROM jobs WHERE id = ?", [doomedJobId]);
  record("Cycle rejeu -> échec propre, pas de boucle", doomed2?.status === "failed" && doomed2.attempts === 1);

  console.log("\n── Piste d'audit ──────────────────────────────────────────");
  const audits = await get<{ retried: number; discarded: number; replayed: number }>(
    `SELECT
       SUM(CASE WHEN action = 'admin.job_retried' THEN 1 ELSE 0 END) AS retried,
       SUM(CASE WHEN action = 'admin.job_discarded' THEN 1 ELSE 0 END) AS discarded,
       SUM(CASE WHEN action = 'admin.webhook_replayed' THEN 1 ELSE 0 END) AS replayed
     FROM audit_logs WHERE actor_id = ?`,
    [admin.id],
  );
  record(
    "Actions super admin journalisées et attribuées",
    Number(audits?.retried) === 2 && Number(audits?.discarded) === 1 && Number(audits?.replayed) === 2,
    `retried=${audits?.retried} discarded=${audits?.discarded} replayed=${audits?.replayed}`,
  );
  void jobCountBefore;
  void claimJobs;

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
