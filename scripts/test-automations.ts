/**
 * Grouped automation contract and guard-chain tests.
 *
 *   npm run test:automations
 *
 * All assertions run against PostgreSQL with the real migration set. No Meta or
 * courier network is contacted.
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

  const { all, get, run, uid, nowIso, closeDb } = await import("../src/server/db");
  const { seedTemplates } = await import("../src/server/services/seedTemplates");
  const { seedAutomations, getAutomation, resolveEventTemplate, onNewOrder, onCustomerReply, onDeliveryStatusChange, runNoResponseReminder } = await import("../src/server/services/automations");
  const { evaluateGuards, queueMessage } = await import("../src/server/services/messaging");
  const { AUTOMATION_GROUP, TEMPLATE_GROUPS } = await import("../src/lib/domain");

  await run(
    "TRUNCATE users, merchants, merchant_users, customers, orders, whatsapp_connections, whatsapp_conversations, whatsapp_messages, whatsapp_templates, satisfaction_scores, jobs, notifications, automations, automation_runs, usage_records, order_events, api_logs RESTART IDENTITY CASCADE",
    [],
  );

  const M1 = "mch_auto_1";
  const M2 = "mch_auto_2";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [M1, "Automation A", "auto-a", "trial"]);
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [M2, "Automation B", "auto-b", "trial"]);
  await seedTemplates(M1);
  await seedTemplates(M2);
  await seedAutomations(M1);
  await seedAutomations(M2);
  await run(
    `UPDATE whatsapp_templates SET status = 'approved'
     WHERE merchant_id = ? AND language = 'fr' AND name IN ('order_confirmation_request','order_shipped','parcel_at_office','out_for_delivery','delivery_reminder','order_delivered')`,
    [M1],
  );

  const rows = await all<{ id: string; type: string; enabled: number; automation_group: string; group_key: string }>("SELECT id, type, enabled, automation_group, group_key FROM automations WHERE merchant_id = ? ORDER BY type", [M1]);
  const groupCounts = (group: string) => rows.filter((row) => row.automation_group === group).length;
  record("Un jeu d'automatisations est créé", rows.length === 9);
  record("Le groupe Confirmation contient les trois réponses de commande", groupCounts("confirmation") === 3);
  record("Le groupe Tracking contient les notifications de suivi", groupCounts("tracking") === 5);
  record("Le groupe Satisfaction contient le remerciement après livraison", groupCounts("satisfaction") === 1);
  record("Chaque automatisation possède un groupe", rows.every((row) => TEMPLATE_GROUPS.includes(row.automation_group as never)));
  record("Le group_key est aligné avec automation_group", rows.every((row) => row.group_key === row.automation_group));
  record("Les groupes ne sont pas mélangés", new Set(rows.map((row) => row.automation_group)).size === 3);
  record("Les groupes sont exposés par la même taxonomie que les templates", Object.values(AUTOMATION_GROUP).every((group) => TEMPLATE_GROUPS.includes(group)));
  record("Le seed active les règles prévues", rows.filter((row) => row.enabled === 1).length === 8);
  await seedAutomations(M1);
  record("Ré-exécuter le seed ne duplique pas les automatisations", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automations WHERE merchant_id = ?", [M1]))?.c) === 9);
  const otherGroups = await all<{ automation_group: string }>("SELECT automation_group FROM automations WHERE merchant_id = ?", [M2]);
  record("Les groupes d'un autre marchand restent séparés", otherGroups.length === 9 && otherGroups.every((row) => !!row.automation_group));

  const newAutomation = await getAutomation(M1, "new_order_confirmation");
  const deliveredAutomation = await getAutomation(M1, "delivered_thanks");
  record("getAutomation retrouve la règle de confirmation", newAutomation?.automation_group === "confirmation");
  record("getAutomation retrouve la règle de satisfaction", deliveredAutomation?.automation_group === "satisfaction");
  const confirmationTemplate = await resolveEventTemplate(M1, "new_order_confirmation", "fr");
  const shippedTemplate = await resolveEventTemplate(M1, "shipped_notice", "fr");
  record("La résolution choisit un template approuvé de confirmation", !!confirmationTemplate);
  record("La résolution choisit un template approuvé de suivi", !!shippedTemplate);
  record("Un évènement sans approbation ne fabrique pas de template", (await resolveEventTemplate(M1, "reply_yes_confirm", "fr")) === null);
  record("Le groupe Confirmation est présent côté templates", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ? AND template_group = 'confirmation'", [M1]))?.c) === 12);
  record("Le groupe Tracking est présent côté templates", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ? AND template_group = 'tracking'", [M1]))?.c) === 15);
  record("Le groupe Return est présent côté templates", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ? AND template_group = 'return'", [M1]))?.c) === 9);
  record("Le groupe Satisfaction est présent côté templates", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ? AND template_group = 'satisfaction'", [M1]))?.c) === 9);
  record("Les neuf types d'automatisation sont uniques", new Set(rows.map((row) => row.type)).size === 9);
  record("Les groupes suivent la table de correspondance", rows.every((row) => AUTOMATION_GROUP[row.type as keyof typeof AUTOMATION_GROUP] === row.automation_group));
  record("Les trois règles de confirmation sont actives", rows.filter((row) => row.automation_group === "confirmation").every((row) => row.enabled === 1));
  record("La notification optionnelle de sortie est désactivée", (await get<{ enabled: number }>("SELECT enabled FROM automations WHERE merchant_id = ? AND type = 'out_for_delivery_notice'", [M1]))?.enabled === 0);
  record("Le rappel de non-réponse a un délai configuré", (await get<{ delay_minutes: number }>("SELECT delay_minutes FROM automations WHERE merchant_id = ? AND type = 'no_response_reminder'", [M1]))?.delay_minutes === 240);
  record("La satisfaction conserve un cooldown spécifique", (await get<{ cooldown_minutes: number }>("SELECT cooldown_minutes FROM automations WHERE merchant_id = ? AND type = 'delivered_thanks'", [M1]))?.cooldown_minutes === 360);
  record("L'alerte technique reste rattachée au suivi", (await get<{ automation_group: string }>("SELECT automation_group FROM automations WHERE merchant_id = ? AND type = 'failed_message_alert'", [M1]))?.automation_group === "tracking");
  record("Un autre marchand ne récupère pas les templates approuvés", (await resolveEventTemplate(M2, "new_order_confirmation", "fr")) === null);
  record("La correspondance groupée est stable après le seed", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automations WHERE merchant_id = ? AND automation_group IS NOT NULL", [M1]))?.c) === 9);
  record("Chaque langue de départ reste disponible pour un groupe", Number((await get<{ c: number }>("SELECT COUNT(DISTINCT language) AS c FROM whatsapp_templates WHERE merchant_id = ? AND template_group = 'satisfaction'", [M1]))?.c) === 3);

  const customer = uid("cus");
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customer, M1, "Amina", "+213600000201", "+213600000201"]);
  const order = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, total, status, delivery_type, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, 'new', 'home', ?, ?)`,
    [order, M1, "CMD-AUTO-1", customer, "Amina", "+213600000201", 4900, nowIso(), nowIso()],
  );

  console.log("\n── Garde de décision et déduplication ──────────────────────");
  const allowed = await evaluateGuards({ merchantId: M1, customerId: customer, orderId: order, toPhone: "+213600000201", templateId: confirmationTemplate, eventKey: "new_order_confirmation" });
  record("Un template approuvé passe les garde-fous", allowed.allowed);
  const draft = await get<{ id: string }>("SELECT id FROM whatsapp_templates WHERE merchant_id = ? AND name = 'satisfaction_request' AND language = 'fr'", [M1]);
  const draftDecision = await evaluateGuards({ merchantId: M1, toPhone: "+213600000202", templateId: draft?.id, eventKey: "manual" });
  record("Un template draft est bloqué", !draftDecision.allowed && draftDecision.reason === "template_not_approved");
  const missing = await evaluateGuards({ merchantId: M1, toPhone: "+213600000203", templateId: "tpl_missing", eventKey: "manual" });
  record("Un template inconnu est bloqué", !missing.allowed && missing.reason === "template_missing");
  await run("UPDATE customers SET opt_out_status = 1 WHERE id = ?", [customer]);
  const optedOut = await evaluateGuards({ merchantId: M1, customerId: customer, toPhone: "+213600000201", templateId: confirmationTemplate, eventKey: "manual" });
  record("Un client désinscrit est bloqué", !optedOut.allowed && optedOut.reason === "opted_out");
  await run("UPDATE customers SET opt_out_status = 0, whatsapp_status = 'unavailable' WHERE id = ?", [customer]);
  const unavailable = await evaluateGuards({ merchantId: M1, customerId: customer, toPhone: "+213600000201", templateId: confirmationTemplate, eventKey: "manual" });
  record("Un numéro déclaré indisponible est bloqué", !unavailable.allowed && unavailable.reason === "not_eligible");
  await run("UPDATE customers SET whatsapp_status = 'unknown' WHERE id = ?", [customer]);

  const queued = await queueMessage({ merchantId: M1, customerId: customer, orderId: order, toPhone: "+213600000201", templateId: confirmationTemplate, eventKey: "new_order_confirmation", automationId: newAutomation?.id, cooldownMinutes: 0 });
  record("Une confirmation autorisée est mise en file", queued.status === "queued" && !!queued.messageId);
  const duplicate = await queueMessage({ merchantId: M1, customerId: customer, orderId: order, toPhone: "+213600000201", templateId: confirmationTemplate, eventKey: "new_order_confirmation", automationId: newAutomation?.id, cooldownMinutes: 0 });
  record("La même confirmation est dédupliquée", duplicate.status === "suppressed" && duplicate.reason === "duplicate");
  const dedupeRun = await get<{ result: string; reason: string | null }>("SELECT result, reason FROM automation_runs WHERE merchant_id = ? AND reason = 'duplicate' ORDER BY created_at DESC LIMIT 1", [M1]);
  record("La déduplication est journalisée", dedupeRun?.result === "suppressed" && dedupeRun.reason === "duplicate");
  record("La file contient bien un job d'envoi", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM jobs WHERE merchant_id = ? AND type = 'send_whatsapp'", [M1]))?.c) === 1);
  record("La commande porte le statut WhatsApp queued", (await get<{ whatsapp_status: string }>("SELECT whatsapp_status FROM orders WHERE id = ?", [order]))?.whatsapp_status === "queued");

  console.log("\n── Déclencheurs regroupés ───────────────────────────────────");
  await run("UPDATE orders SET status = 'new', last_reply_at = NULL WHERE id = ?", [order]);
  await onNewOrder(order);
  record("Une nouvelle commande déclenche la confirmation", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE order_id = ?", [order]))?.c ?? 0) >= 1);
  record("L'exécution de confirmation est tracée", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND automation_id = ?", [order, newAutomation?.id]))?.c ?? 0) >= 1);
  record("Le rappel de non-réponse est planifié", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM jobs WHERE merchant_id = ? AND type = 'reminder'", [M1]))?.c ?? 0) >= 1);

  await run("UPDATE orders SET status = 'awaiting_confirmation' WHERE id = ?", [order]);
  await onCustomerReply(order, M1, "yes");
  record("Réponse oui : commande confirmée", (await get<{ status: string }>("SELECT status FROM orders WHERE id = ?", [order]))?.status === "confirmed");
  record("Réponse oui : règle de confirmation exécutée", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND trigger = 'customer.reply_yes' AND result = 'sent'", [order]))?.c) === 1);
  await run("UPDATE orders SET status = 'awaiting_confirmation' WHERE id = ?", [order]);
  await onCustomerReply(order, M1, "no");
  record("Réponse non : commande annulée", (await get<{ status: string }>("SELECT status FROM orders WHERE id = ?", [order]))?.status === "cancelled_by_customer");
  record("Réponse non : règle d'annulation exécutée", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND trigger = 'customer.reply_no' AND result = 'sent'", [order]))?.c) === 1);

  await run("UPDATE orders SET status = 'confirmed', delivery_status = 'pending' WHERE id = ?", [order]);
  await onDeliveryStatusChange(order, M1, "shipped", "colis expédié");
  record("Statut expédié : commande passée à shipped", (await get<{ status: string; delivery_status: string }>("SELECT status, delivery_status FROM orders WHERE id = ?", [order]))?.status === "shipped");
  record("Statut expédié : automatisation Tracking exécutée", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND trigger IN ('delivery.shipped','shipped_notice')", [order]))?.c) >= 1);
  const beforeInternal = Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE order_id = ?", [order]))?.c);
  await onDeliveryStatusChange(order, M1, "in_transit", "en transit");
  record("Statut interne en transit : aucun message ajouté", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE order_id = ?", [order]))?.c) === beforeInternal);
  await onDeliveryStatusChange(order, M1, "at_agency", "arrivé au bureau");
  record("Arrivée en agence : groupe Tracking déclenché", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND trigger = 'delivery.at_agency'", [order]))?.c) === 1);
  await onDeliveryStatusChange(order, M1, "out_for_delivery", "en livraison");
  record("Sortie en livraison : statut normalisé", (await get<{ status: string }>("SELECT status FROM orders WHERE id = ?", [order]))?.status === "out_for_delivery");
  await onDeliveryStatusChange(order, M1, "delivered", "livré");
  record("Livraison : commande passée à delivered", (await get<{ status: string }>("SELECT status FROM orders WHERE id = ?", [order]))?.status === "delivered");
  record("Livraison : groupe Satisfaction déclenché", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND trigger IN ('delivery.delivered','delivered_thanks')", [order]))?.c) >= 1);
  await onDeliveryStatusChange(order, M1, "returned", "retourné");
  record("Retour : commande passée à returned", (await get<{ status: string }>("SELECT status FROM orders WHERE id = ?", [order]))?.status === "returned");
  record("Retour : notification interne créée", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE merchant_id = ? AND type = 'parcel_returned'", [M1]))?.c) >= 1);

  const noReply = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, total, status, delivery_type) VALUES (?,?,?,?,?,?,?, 'awaiting_confirmation', 'home')`,
    [noReply, M1, "CMD-AUTO-2", customer, "Amina", "+213600000201", 3000],
  );
  await run("UPDATE customers SET whatsapp_status = 'unknown' WHERE id = ?", [customer]);
  await runNoResponseReminder(noReply);
  record("Sans réponse : commande marquée no_response", (await get<{ status: string }>("SELECT status FROM orders WHERE id = ?", [noReply]))?.status === "no_response");
  record("Sans réponse : rappel tracé dans les automatisations", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM automation_runs WHERE order_id = ? AND trigger IN ('order.no_response','no_response_reminder')", [noReply]))?.c) === 1);

  await run("UPDATE automations SET enabled = 0 WHERE merchant_id = ? AND type = 'new_order_confirmation'", [M1]);
  const disabledOrder = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, total, status, delivery_type) VALUES (?,?,?,?,?,?,?, 'new', 'home')`,
    [disabledOrder, M1, "CMD-AUTO-3", customer, "Amina", "+213600000201", 3000],
  );
  await onNewOrder(disabledOrder);
  record("Une automatisation désactivée n'envoie rien", Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE order_id = ?", [disabledOrder]))?.c) === 0);
  record("Une automatisation désactivée est tracée comme skipped", (await get<{ result: string; reason: string | null }>("SELECT result, reason FROM automation_runs WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", [disabledOrder]))?.result === "skipped");

  const passed = results.filter((item) => item.ok).length;
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  ${passed}/${results.length} tests réussis\n`);
  for (const result of results.filter((item) => !item.ok)) console.log(`  ÉCHEC: ${result.name} ${result.detail}`);
  await closeDb();
  await pg.stop();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
