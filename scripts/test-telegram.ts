/**
 * Tests de l'envoi d'alertes Telegram.
 *
 *   npm run test:telegram
 *
 * Tourne sur un VRAI PostgreSQL (binaires embarqués) avec les migrations
 * réelles. Le réseau est remplacé par un stub du fetch global : AUCUN appel
 * réel à api.telegram.org n'est effectué et aucun succès réel n'est revendiqué.
 *
 * CE QUI EST TESTÉ :
 *   - échappement Markdown : un titre/corps contenant _ * ` [ ne casse pas
 *     l'envoi (l'API Telegram rejette sinon tout le message) ;
 *   - le texte envoyé contient le titre en gras et le corps échappé ;
 *   - l'URL et le chat ID proviennent des identifiants chiffrés stockés ;
 *   - succès : api_logs enregistré, last_sync_at mis à jour ;
 *   - token invalide (401) : intégration marquée en erreur, erreur décrite ;
 *   - erreur transitoire (429) : intégration NON marquée en erreur (le job
 *     sera retenté par la file) ;
 *   - Telegram non configuré : résultat « configured=false », le job
 *     notify_telegram ne doit PAS échouer pour autant ;
 *   - le worker traite un job notify_telegram de bout en bout (envoi,
 *     journalisation, complétion) et échoue proprement sur un refus définitif.
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

  const { get, run, uid, nowIso } = await import("../src/server/db");
  const { encryptSecret } = await import("../src/server/crypto");
  const { escapeTelegramMarkdown, sendTelegramAlert } = await import("../src/server/services/telegram");
  const { enqueueJob } = await import("../src/server/jobs/queue");
  const { runWorker } = await import("../src/server/jobs/worker");

  await run(
    "TRUNCATE users, merchants, merchant_users, integrations, jobs, api_logs, notifications, customers, orders RESTART IDENTITY CASCADE",
    [],
  );
  const merchantId = "mch_tg_test";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [merchantId, "TG Test", "tg-test", "trial"]);

  console.log("── Échappement Markdown ───────────────────────────────────");
  record(
    "Caractères spéciaux échappés (le « ] » n'est pas spécial)",
    escapeTelegramMarkdown("a_b *c* `d` [e]") === "a\\_b \\*c\\* \\`d\\` \\[e]",
    escapeTelegramMarkdown("a_b *c* `d` [e]"),
  );
  record("Texte sans spéciaux inchangé", escapeTelegramMarkdown("Commande CMD-42 livrée") === "Commande CMD-42 livrée");

  console.log("\n── Envoi (fetch substitué, aucun réseau réel) ─────────────");

  const integId = uid("int");
  await run(
    `INSERT INTO integrations (id, merchant_id, kind, label, status, credentials_encrypted, settings)
     VALUES (?,?, 'telegram', 'telegram', 'connected', ?, '{}')`,
    [integId, merchantId, encryptSecret({ bot_token: "123456:TEST-TOKEN", chat_id: "987654321" })],
  );

  const realFetch = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let telegramStatus = 200;
  let telegramDescription = "ok";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.startsWith("https://api.telegram.org/")) {
      calls.push({ url: u, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ ok: telegramStatus === 200, description: telegramDescription }), {
        status: telegramStatus,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const sent = await sendTelegramAlert(merchantId, "Nouvelle commande CMD-42", "Client : Amine_B *urgent* [Alger]");
  record("Envoi réussi", sent.ok === true);
  record(
    "URL construite depuis le token stocké",
    calls[0]?.url === "https://api.telegram.org/bot123456:TEST-TOKEN/sendMessage",
    calls[0]?.url ?? "",
  );
  record("Chat ID transmis", calls[0]?.body.chat_id === "987654321");
  record(
    "Titre en gras, données dynamiques échappées",
    calls[0]?.body.text === "*Nouvelle commande CMD-42*\nClient : Amine\\_B \\*urgent\\* \\[Alger]",
    String(calls[0]?.body.text),
  );
  record("parse_mode Markdown", calls[0]?.body.parse_mode === "Markdown");
  const log = await get<{ ok: number; service: string; operation: string }>(
    "SELECT ok, service, operation FROM api_logs WHERE service = 'telegram' ORDER BY created_at DESC LIMIT 1",
  );
  record("Appel journalisé dans api_logs", log?.ok === 1 && log.operation === "sendMessage");
  const integOk = await get<{ status: string; last_sync_at: string | null }>("SELECT status, last_sync_at FROM integrations WHERE id = ?", [integId]);
  record("last_sync_at mis à jour", !!integOk?.last_sync_at);

  console.log("\n── Refus définitif vs transitoire ────────────────────────");

  telegramStatus = 401;
  telegramDescription = "Unauthorized";
  const refused = await sendTelegramAlert(merchantId, "Test", "corps");
  record("Token invalide : ok=false, erreur décrite", refused.ok === false && refused.error === "Unauthorized");
  const integErr = await get<{ status: string; last_error: string | null }>("SELECT status, last_error FROM integrations WHERE id = ?", [integId]);
  record("Intégration marquée en erreur (401)", integErr?.status === "error" && integErr?.last_error === "Unauthorized");

  // Réparation simulée + erreur transitoire : l'intégration ne doit PAS
  // passer en erreur (la file retentera).
  await run("UPDATE integrations SET status = 'connected', last_error = NULL WHERE id = ?", [integId]);
  telegramStatus = 429;
  telegramDescription = "Too Many Requests: retry after 5";
  const throttled = await sendTelegramAlert(merchantId, "Test", "corps");
  record("429 : ok=false mais transitoire", throttled.ok === false && throttled.configured === true);
  const integ429 = await get<{ status: string }>("SELECT status FROM integrations WHERE id = ?", [integId]);
  record("429 : intégration toujours « connected »", integ429?.status === "connected");

  console.log("\n── Non configuré ──────────────────────────────────────────");

  const missing = await sendTelegramAlert("mch_sans_telegram", "Test", "corps");
  record("Sans intégration : configured=false", missing.ok === false && missing.configured === false);

  console.log("\n── Job notify_telegram de bout en bout ───────────────────");

  telegramStatus = 200;
  telegramDescription = "ok";
  calls.length = 0;
  const jobId = await enqueueJob({ merchantId, type: "notify_telegram", payload: { title: "Commande livrée", body: "CMD-43 remise effectuée" } });
  await runWorker(5);
  const job = await get<{ status: string; last_error: string | null }>("SELECT status, last_error FROM jobs WHERE id = ?", [jobId]);
  record("Job complété", job?.status === "done", `statut=${job?.status} erreur=${job?.last_error ?? ""}`);
  record("Message envoyé par le worker", calls.length === 1 && String(calls[0]?.body.text).includes("*Commande livrée*"));

  // Refus définitif pendant un job : le job doit échouer (et sera retenté).
  telegramStatus = 400;
  telegramDescription = "Bad Request: chat not found";
  const jobId2 = await enqueueJob({ merchantId, type: "notify_telegram", payload: { title: "Alerte", body: "test" }, maxAttempts: 1 });
  await runWorker(5);
  const job2 = await get<{ status: string; last_error: string | null }>("SELECT status, last_error FROM jobs WHERE id = ?", [jobId2]);
  record("Refus définitif : job en échec avec l'erreur Telegram", job2?.status === "failed" && job2?.last_error === "Bad Request: chat not found", job2?.last_error ?? "");

  globalThis.fetch = realFetch;
  void nowIso;

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
