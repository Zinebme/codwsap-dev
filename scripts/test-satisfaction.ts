/**
 * Satisfaction WhatsApp : capture, idempotence, isolation and analytics.
 *
 *   npm run test:satisfaction
 *
 * The suite uses the real PostgreSQL schema and never calls Meta. A score is
 * accepted only in the 1–5 range and the webhook path associates it with the
 * customer's delivered order.
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

  const { get, run, uid, nowIso, closeDb } = await import("../src/server/db");
  const {
    SATISFACTION_SCORES,
    parseSatisfactionScore,
    recordSatisfactionScore,
    captureSatisfactionReply,
    satisfactionSummary,
    satisfactionByDay,
  } = await import("../src/server/services/satisfaction");

  await run(
    "TRUNCATE users, merchants, merchant_users, customers, orders, whatsapp_conversations, whatsapp_messages, whatsapp_templates, satisfaction_scores, order_events, jobs, notifications, automations, automation_runs RESTART IDENTITY CASCADE",
    [],
  );

  console.log("\n── Analyse des réponses 1–5 ───────────────────────────────");
  record("Le chiffre 1 est accepté", SATISFACTION_SCORES.includes(1) && parseSatisfactionScore("1") === 1);
  record("La forme 5/5 est acceptée", parseSatisfactionScore("5/5") === 5);
  record("Les chiffres arabo-indiens sont acceptés", parseSatisfactionScore("٤") === 4);
  record("Le préfixe Note est accepté", parseSatisfactionScore("Note 3") === 3);
  record("Une note hors intervalle est refusée", parseSatisfactionScore("6") === null && parseSatisfactionScore("0") === null);
  record("Un texte contenant un nombre n'est pas une note", parseSatisfactionScore("commande 123") === null);

  const merchant = "mch_sat_a";
  const otherMerchant = "mch_sat_b";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [merchant, "Satisfaction A", "sat-a", "trial"]);
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [otherMerchant, "Satisfaction B", "sat-b", "trial"]);
  const customer = uid("cus");
  const otherCustomer = uid("cus");
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customer, merchant, "Leïla", "+213600000101", "+213600000101"]);
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [otherCustomer, otherMerchant, "Autre", "+213600000102", "+213600000102"]);
  const order = uid("ord");
  const otherOrder = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, total, status, delivery_type, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'delivered', 'home', ?, ?)`,
    [order, merchant, "CMD-SAT-1", customer, "Leïla", "+213600000101", 4200, nowIso(), nowIso()],
  );
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, total, status, delivery_type, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'delivered', 'home', ?, ?)`,
    [otherOrder, otherMerchant, "CMD-SAT-2", otherCustomer, "Autre", "+213600000102", 4200, nowIso(), nowIso()],
  );
  const conversation = uid("cnv");
  await run("INSERT INTO whatsapp_conversations (id, merchant_id, customer_id, order_id, normalized_phone) VALUES (?,?,?,?,?)", [conversation, merchant, customer, order, "+213600000101"]);
  const inbound = uid("msg");
  await run("INSERT INTO whatsapp_messages (id, merchant_id, conversation_id, order_id, customer_id, direction, kind, body, status) VALUES (?,?,?,?,?, 'inbound', 'text', ?, 'received')", [inbound, merchant, conversation, order, customer, "5"]);

  console.log("\n── Stockage et idempotence ─────────────────────────────────");
  const first = await recordSatisfactionScore({ merchantId: merchant, customerId: customer, orderId: order, conversationId: conversation, messageId: inbound, score: 5, comment: "Très bien" });
  record("Une première note est stockée", first?.score === 5 && first?.order_id === order);
  const denorm = await get<{ satisfaction_score: number; satisfaction_comment: string | null }>("SELECT satisfaction_score, satisfaction_comment FROM orders WHERE id = ?", [order]);
  record("La note est visible sur la commande", denorm?.satisfaction_score === 5 && denorm.satisfaction_comment === "Très bien");
  record("La colonne rating reste alignée", (await get<{ rating: number }>("SELECT rating FROM satisfaction_scores WHERE order_id = ?", [order]))?.rating === 5);
  const updated = await recordSatisfactionScore({ merchantId: merchant, customerId: customer, orderId: order, score: 3, comment: "Correct" });
  record("Une nouvelle réponse met à jour la note de la commande", updated?.score === 3 && updated?.comment === "Correct");
  record("La mise à jour ne crée pas de doublon", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM satisfaction_scores WHERE merchant_id = ? AND order_id = ?", [merchant, order]))?.c) === 1);
  record("La commande suit la note révisée", (await get<{ satisfaction_score: number }>("SELECT satisfaction_score FROM orders WHERE id = ?", [order]))?.satisfaction_score === 3);

  console.log("\n── Capture depuis le flux WhatsApp ─────────────────────────");
  const captured = await captureSatisfactionReply({ merchantId: merchant, customerId: customer, orderId: order, conversationId: conversation, messageId: inbound, text: "4/5" });
  record("Une réponse WhatsApp est capturée", captured?.score === 4);
  record("La capture conserve l'ordre associé", (await get<{ order_id: string }>("SELECT order_id FROM satisfaction_scores WHERE merchant_id = ? AND customer_id = ?", [merchant, customer]))?.order_id === order);
  record("Une réponse invalide ne crée rien", (await captureSatisfactionReply({ merchantId: merchant, customerId: customer, orderId: order, text: "merci 123" })) === null);
  const pendingOrder = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, total, status, delivery_type) VALUES (?,?,?,?,?,?,?, 'awaiting_confirmation', 'home')`,
    [pendingOrder, merchant, "CMD-SAT-PENDING", customer, "Leïla", "+213600000101", 2000],
  );
  record("Une note sans livraison n'est pas associée", (await captureSatisfactionReply({ merchantId: merchant, customerId: customer, orderId: pendingOrder, text: "2" })) === null);
  record("La dernière note valide reste la note de la commande livrée", (await get<{ score: number }>("SELECT score FROM satisfaction_scores WHERE order_id = ?", [order]))?.score === 4);

  console.log("\n── Agrégats, filtres et isolation ──────────────────────────");
  await recordSatisfactionScore({ merchantId: otherMerchant, customerId: otherCustomer, orderId: otherOrder, score: 1, source: "whatsapp" });
  const summary = await satisfactionSummary(merchant, { from: "2000-01-01", to: "2100-01-01" });
  record("Le résumé compte les réponses du marchand", summary.responses === 1);
  record("La moyenne du marchand est correcte", summary.average === 4);
  record("Le taux positif est calculé", summary.positiveRate === 100);
  record("La distribution contient la note 4", summary.distribution["4"] === 1);
  record("Les notes des autres marchands sont exclues", (await satisfactionSummary(merchant)).responses === 1);
  record("Le filtre minimum exclut les notes inférieures", (await satisfactionSummary(merchant, { minScore: 5 })).responses === 0);
  record("Le filtre maximum conserve la note", (await satisfactionSummary(merchant, { maxScore: 4 })).responses === 1);
  const byDay = await satisfactionByDay(merchant, { from: "2000-01-01", to: "2100-01-01" });
  record("Les agrégats journaliers renvoient la journée", byDay.length === 1 && byDay[0].responses === 1);
  record("Le score respecte la contrainte 1–5", (await get<{ c: number }>("SELECT COUNT(*) AS c FROM satisfaction_scores WHERE score BETWEEN 1 AND 5", []))?.c === 2);

  const passed = results.filter((result) => result.ok).length;
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  ${passed}/${results.length} tests réussis\n`);
  for (const result of results.filter((item) => !item.ok)) console.log(`  ÉCHEC: ${result.name} ${result.detail}`);
  await closeDb();
  await pg.stop();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
