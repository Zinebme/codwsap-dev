/**
 * Tests de la couche WhatsApp : variables de template et preuves de disponibilité.
 *
 *   npm run test:whatsapp
 *
 * Tourne sur un VRAI PostgreSQL (binaries embarqués) avec les migrations
 * réelles (y compris 0005_whatsapp_completion.sql).
 *
 * CE QUI EST TESTÉ (hors ligne) :
 *   - les valeurs ordonnées des variables de template sont calculées et
 *     stockées sur le message (l'API Cloud exige des paramètres positionnels) ;
 *   - un envoi manuel de template sans variables explicites hérite du contexte
 *     de la commande rattachée (mêmes variables que les automatisations) ;
 *   - le composant « template » envoyé à Meta porte les paramètres du corps,
 *     dans l'ordre — et aucun composant vide ;
 *   - la livraison via le bac à sable fonctionne de bout en bout ;
 *   - le rapprochement de disponibilité ne suit QUE des preuves :
 *       . message livré  -> client « available » (source : accusé de réception) ;
 *       . échec 131026 sans aucune livraison -> « unavailable » ;
 *       . une preuve de livraison PRIME toujours sur un échec ;
 *       . sans preuve, le statut reste « unknown » (rien n'est inventé) ;
 *   - le rapprochement ne fuit pas d'un marchand à l'autre ;
 *   - la page « Réglages WhatsApp » ne crash pas (identifiants absents ou
 *     corrompus) et sa réponse ne fuit ni le secret de webhook, ni le jeton
 *     d'accès en clair (masquage uniquement).
 *
 * CE QUI N'EST PAS TESTÉ ICI : le dialogue réel avec l'API Cloud Meta
 * (graph.facebook.com), qui exige des identifiants et un numéro WhatsApp
 * Business. Aucun succès de ce type n'est revendiqué.
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
  const { queueMessage, deliverQueuedMessage, refreshAvailabilityEvidence, orderedTemplateValues, orderVariables } = await import(
    "../src/server/services/messaging"
  );
  const { templateComponent, renderTemplate, safeConnectionPayload } = await import("../src/server/connectors/whatsapp");
  const { encryptSecret, decryptSecret, maskSecret } = await import("../src/server/crypto");

  console.log("── Composant template pour l'API Cloud Meta ───────────────");

  const comp = templateComponent("order_confirmed", "fr", ["Amine", "CMD-42"]);
  record(
    "Paramètres positionnels dans l'ordre",
    comp.name === "order_confirmed" &&
      comp.language.code === "fr" &&
      comp.components.length === 1 &&
      comp.components[0].type === "body" &&
      JSON.stringify(comp.components[0].parameters) === JSON.stringify([
        { type: "text", text: "Amine" },
        { type: "text", text: "CMD-42" },
      ]),
  );
  const compEmpty = templateComponent("no_vars", "ar", []);
  record("Aucun composant quand il n'y a pas de variables", compEmpty.components.length === 0);
  record(
    "Valeurs ordonnées : nommées puis positionnelles, vide sinon",
    JSON.stringify(orderedTemplateValues(["customer_name", "order_ref"], { customer_name: "Leïla", order_ref: "R1" })) ===
      JSON.stringify(["Leïla", "R1"]) &&
      JSON.stringify(orderedTemplateValues(["1", "2"], { "1": "a", v2: "b" })) === JSON.stringify(["a", "b"]) &&
      JSON.stringify(orderedTemplateValues(["x"], {})) === JSON.stringify([""]),
  );

  console.log("\n── File d'attente : variables stockées sur le message ──────");

  await run(
    "TRUNCATE users, merchants, merchant_users, customers, orders, whatsapp_connections, whatsapp_conversations, whatsapp_messages, whatsapp_templates, jobs, notifications, automations, automation_runs RESTART IDENTITY CASCADE",
    [],
  );
  const merchantId = "mch_wa_test";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [merchantId, "WA Test", "wa-test", "trial"]);

  // Template approuvé avec variables positionnelles {{1}} {{2}} et métadonnées nommées.
  const tplId = uid("tpl");
  await run(
    `INSERT INTO whatsapp_templates (id, merchant_id, name, category, language, status, body, variables, buttons, event_key)
     VALUES (?,?,?,?, 'fr', 'approved', ?, ?, '[]', 'new_order_confirmation')`,
    [tplId, merchantId, "order_confirmed", "utility", "Bonjour {{1}}, commande {{2}} reçue.", JSON.stringify(["customer_name", "order_ref"])],
  );

  const customerId = uid("cus");
  await run(
    "INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)",
    [customerId, merchantId, "Amine Boudiaf", "+213555000111", "+213555000111"],
  );
  const orderId = uid("ord");
  await run(
    `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, wilaya, delivery_type, products_price, delivery_price, total, status, created_at)
     VALUES (?,?,?,?,?,?,?, 'home', 2000, 500, 2500, 'new', ?)`,
    [orderId, merchantId, "CMD-42", customerId, "Amine Boudiaf", "+213555000111", "Alger", nowIso()],
  );

  // 1) Envoi automatisé : variables explicites.
  const auto = await queueMessage({
    merchantId,
    orderId,
    customerId,
    toPhone: "+213555000111",
    templateId: tplId,
    eventKey: "new_order_confirmation",
    variables: orderVariables({ customer_name: "Amine Boudiaf", reference: "CMD-42", total: 2500, tracking_number: null, wilaya: "Alger", commune: null }),
  });
  record("Message automatisé accepté (queued)", auto.status === "queued", `statut=${auto.status}`);
  const autoMsg = await get<{ template_variables: string | null; body: string; status: string }>(
    "SELECT template_variables, body, status FROM whatsapp_messages WHERE id = ?",
    [auto.messageId ?? ""],
  );
  record(
    "Valeurs ordonnées stockées pour l'API Cloud",
    autoMsg?.template_variables === JSON.stringify(["Amine Boudiaf", "CMD-42"]),
    autoMsg?.template_variables ?? "(null)",
  );
  record("Corps rendu localement cohérent", autoMsg?.body === "Bonjour Amine Boudiaf, commande CMD-42 reçue.", autoMsg?.body);

  // 2) Envoi manuel depuis une conversation : AUCUNE variable explicite ->
  //    hérite du contexte de la commande rattachée.
  const manual = await queueMessage({
    merchantId,
    orderId,
    customerId,
    toPhone: "+213555000111",
    templateId: tplId,
    eventKey: "manual",
    bypassGuards: true,
  });
  const manualMsg = await get<{ template_variables: string | null; body: string }>(
    "SELECT template_variables, body FROM whatsapp_messages WHERE id = ?",
    [manual.messageId ?? ""],
  );
  record(
    "Envoi manuel : variables héritées de la commande",
    manualMsg?.template_variables === JSON.stringify(["Amine Boudiaf", "CMD-42"]),
    manualMsg?.template_variables ?? "(null)",
  );

  // 3) Livraison via le bac à sable (aucun réseau).
  const delivered = await deliverQueuedMessage(auto.messageId!);
  record("Livraison via bac à sable", delivered.ok === true);
  const sentMsg = await get<{ status: string; wa_message_id: string | null }>("SELECT status, wa_message_id FROM whatsapp_messages WHERE id = ?", [auto.messageId!]);
  record("Message marqué envoyé avec identifiant WA", sentMsg?.status === "sent" && !!sentMsg?.wa_message_id);

  console.log("\n── Rapprochement de disponibilité (preuves uniquement) ─────");

  // Client A : message livré -> available.
  // Client B : échec 131026, aucune livraison -> unavailable.
  // Client C : échec 131026 PUIS livraison -> available (la preuve prime).
  // Client D : aucune preuve -> unknown (rien n'est inventé).
  // Client E (autre marchand) : livraison chez lui -> non concerné par notre run.
  const customerB = uid("cus");
  const customerC = uid("cus");
  const customerD = uid("cus");
  const customerE = uid("cus");
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customerB, merchantId, "B", "+213555000112", "+213555000112"]);
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customerC, merchantId, "C", "+213555000113", "+213555000113"]);
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customerD, merchantId, "D", "+213555000114", "+213555000114"]);
  const otherMerchant = "mch_wa_other";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [otherMerchant, "Autre", "autre", "trial"]);
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customerE, otherMerchant, "E", "+213555000115", "+213555000115"]);

  const conv = async (customer: string, phone: string) => {
    const id = uid("cnv");
    await run("INSERT INTO whatsapp_conversations (id, merchant_id, customer_id, normalized_phone) VALUES (?,?,?,?)", [id, merchantId, customer, phone]);
    return id;
  };
  const msg = async (convId: string, customer: string, status: string, errorCode: string | null) => {
    await run(
      `INSERT INTO whatsapp_messages (id, merchant_id, conversation_id, customer_id, direction, kind, status, error_code, created_at)
       VALUES (?,?,?,?,'outbound','text',?,?,?)`,
      [uid("msg"), merchantId, convId, customer, status, errorCode, nowIso()],
    );
  };

  const convB = await conv(customerB, "+213555000112");
  await msg(convB, customerB, "failed", "131026");

  // Le bac à sable marque « sent » (l'accusé de réception ne vient que du
  // webhook réel) : on ajoute la preuve de livraison pour le client A.
  const convA = (await get<{ id: string }>("SELECT id FROM whatsapp_conversations WHERE merchant_id = ? AND customer_id = ?", [merchantId, customerId]))!.id;
  await msg(convA, customerId, "delivered", null);

  const convC = await conv(customerC, "+213555000113");
  await msg(convC, customerC, "failed", "131026");
  await msg(convC, customerC, "delivered", null);

  const convD = await conv(customerD, "+213555000114");
  await msg(convD, customerD, "sent", null);

  // Chez l'autre marchand : une livraison qui ne doit PAS être touchée par notre run.
  const convE = uid("cnv");
  await run("INSERT INTO whatsapp_conversations (id, merchant_id, customer_id, normalized_phone) VALUES (?,?,?,?)", [convE, otherMerchant, customerE, "+213555000115"]);
  await run(
    `INSERT INTO whatsapp_messages (id, merchant_id, conversation_id, customer_id, direction, kind, status, created_at)
     VALUES (?,?,?,?,'outbound','text','delivered',?)`,
    [uid("msg"), otherMerchant, convE, customerE, nowIso()],
  );

  const counts = await refreshAvailabilityEvidence(merchantId);
  const statusOf = async (id: string) => (await get<{ whatsapp_status: string; whatsapp_check_source: string | null }>("SELECT whatsapp_status, whatsapp_check_source FROM customers WHERE id = ?", [id]));
  const a = await statusOf(customerId);
  const b = await statusOf(customerB);
  const c = await statusOf(customerC);
  const d = await statusOf(customerD);
  const e = await statusOf(customerE);

  record("Message livré -> client « available » (preuve)", a?.whatsapp_status === "available" && a?.whatsapp_check_source === "delivery_receipt");
  record("Échec 131026 sans livraison -> « unavailable »", b?.whatsapp_status === "unavailable" && b?.whatsapp_check_source === "delivery_failure");
  record("Une preuve de livraison PRIME sur un échec", c?.whatsapp_status === "available");
  record("Sans preuve, le statut reste « unknown »", d?.whatsapp_status === "unknown");
  record("Aucune fuite entre marchands", e?.whatsapp_status === "unknown");
  record("Comptage cohérent", counts.available === 2 && counts.unavailable === 1, `available=${counts.available} unavailable=${counts.unavailable}`);

  // Le client D devient livré plus tard : la preuve le fait passer à available.
  await msg(convD, customerD, "delivered", null);
  await refreshAvailabilityEvidence(merchantId);
  record("Preuve tardive : « unknown » devient « available »", (await statusOf(customerD))?.whatsapp_status === "available");

  // Un échec non-131026 (ex. token expiré) ne doit rien déduire.
  const customerF = uid("cus");
  await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [customerF, merchantId, "F", "+213555000116", "+213555000116"]);
  const convF = await conv(customerF, "+213555000116");
  await msg(convF, customerF, "failed", "1900");
  await refreshAvailabilityEvidence(merchantId);
  record("Échec autre que 131026 : aucune déduction", (await statusOf(customerF))?.whatsapp_status === "unknown");

  console.log("\n── Rendu local des templates ───────────────────────────────");
  record(
    "Placeholders positionnels et nommés",
    renderTemplate("A {{1}} / {{customer_name}} / {{manquant}}", { "1": "X", customer_name: "Y" }) === "A X / Y / ",
  );

  console.log("\n── Alerte « message échoué » : interrupteur réel ───────────");
  // L'automatisation failed_message_alert est semée pour chaque marchand ;
  // son interrupteur doit être respecté par markMessageFailed.
  const { markMessageFailed } = await import("../src/server/services/messaging");
  const { seedAutomations } = await import("../src/server/services/automations");
  await seedAutomations(merchantId);
  const alertAutomation = await get<{ id: string; enabled: number }>(
    "SELECT id, enabled FROM automations WHERE merchant_id = ? AND type = 'failed_message_alert'",
    [merchantId],
  );
  record("Automatisation d'alerte semée et active", !!alertAutomation && alertAutomation.enabled === 1);

  // Un message qui échoue définitivement -> notification + trace d'exécution.
  const failingMsgId = uid("msg");
  await run(
    `INSERT INTO whatsapp_messages (id, merchant_id, conversation_id, customer_id, direction, kind, status, created_at)
     VALUES (?,?,NULL, NULL,'outbound','text','failed',?)`,
    [failingMsgId, merchantId, nowIso()],
  );
  await markMessageFailed(failingMsgId, "HTTP 500 côté Meta");
  const alertRun = await get<{ result: string; reason: string | null }>(
    "SELECT result, reason FROM automation_runs WHERE merchant_id = ? AND trigger = 'message.failed' ORDER BY created_at DESC LIMIT 1",
    [merchantId],
  );
  const alertNotif = await get<{ id: string }>(
    "SELECT id FROM notifications WHERE merchant_id = ? AND type = 'message_failed' ORDER BY created_at DESC LIMIT 1",
    [merchantId],
  );
  record("Alerte émise et journalisée quand l'automatisation est active", alertRun?.result === "sent" && !!alertNotif);

  // Interrupteur coupé -> plus aucune notification, trace « skipped ».
  await run("UPDATE automations SET enabled = 0 WHERE id = ?", [alertAutomation!.id]);
  const notifCountBefore = Number(
    (await get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE merchant_id = ? AND type = 'message_failed'", [merchantId]))?.c,
  );
  const failingMsgId2 = uid("msg");
  await run(
    `INSERT INTO whatsapp_messages (id, merchant_id, conversation_id, customer_id, direction, kind, status, created_at)
     VALUES (?,?,NULL, NULL,'outbound','text','failed',?)`,
    [failingMsgId2, merchantId, nowIso()],
  );
  await markMessageFailed(failingMsgId2, "HTTP 500 côté Meta");
  const notifCountAfter = Number(
    (await get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE merchant_id = ? AND type = 'message_failed'", [merchantId]))?.c,
  );
  const skippedRun = await get<{ result: string; reason: string | null }>(
    "SELECT result, reason FROM automation_runs WHERE merchant_id = ? AND trigger = 'message.failed' AND reason = 'automation_disabled' LIMIT 1",
    [merchantId],
  );
  record("Interrupteur respecté : aucune alerte quand désactivée", notifCountAfter === notifCountBefore);
  record("Échec journalisé comme « skipped » (traçabilité)", skippedRun?.result === "skipped" && skippedRun?.reason === "automation_disabled");

  console.log("\n── Réglages WhatsApp : pas de crash, pas de fuite ───────────");
  // Le payload de la page Réglages est une projection explicite : même si la
  // ligne porte des secrets, ils ne doivent jamais apparaître dans la réponse.
  const tokenConnexion = "EAAGtest-token-reglages-0123456789";
  const rowConnexion: Record<string, unknown> & Parameters<typeof safeConnectionPayload>[0] = {
    id: "wac_reglages",
    merchant_id: merchantId,
    display_phone: "+213555000111",
    phone_number_id: "pnid_reglages",
    business_account_id: "baid_reglages",
    status: "connected",
    quality_rating: null,
    webhook_verify_token: "vt_reglages",
    last_webhook_at: null,
    last_message_at: null,
    last_error: null,
    last_error_at: null,
    // Champs SENSIBLES portés par la ligne (doivent disparaître du payload) :
    credentials_encrypted: encryptSecret({ access_token: tokenConnexion }),
    webhook_secret: "whsec-reglages-ne-jamais-fuir",
    meta_metrics: JSON.stringify({ interne: true }),
  };
  const payloadReglages = safeConnectionPayload(rowConnexion, decryptSecret<{ access_token?: string }>(rowConnexion.credentials_encrypted as string)?.access_token);
  const payloadJson = JSON.stringify(payloadReglages);
  record("Réglages : le secret de webhook ne figure jamais dans le payload",
    !payloadJson.includes("whsec-reglages-ne-jamais-fuir") && !("webhook_secret" in payloadReglages));
  record("Réglages : le blob chiffré et les métriques internes ne figurent jamais dans le payload",
    !("credentials_encrypted" in payloadReglages) && !("meta_metrics" in payloadReglages));
  record("Réglages : le jeton d'accès n'apparaît que masqué",
    payloadReglages.access_token_masked === maskSecret(tokenConnexion) && !payloadJson.includes(tokenConnexion));
  record("Réglages : pas de crash sans identifiants ni avec un blob corrompu",
    safeConnectionPayload(rowConnexion, decryptSecret("v1.corrompu.corrompu.corrompu") ?? undefined).access_token_masked === null &&
      safeConnectionPayload(rowConnexion, undefined).access_token_masked === null);

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
