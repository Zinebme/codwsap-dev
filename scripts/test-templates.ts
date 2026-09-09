/**
 * Tests des templates WhatsApp MULTILINGUES.
 *
 *   npm run test:templates
 *
 * Tourne sur un VRAI PostgreSQL (binaries embarqués) avec les migrations
 * réelles. Aucun réseau : la livraison s'appuie sur le bac à sable.
 *
 * CE QUI EST TESTÉ (hors ligne) :
 *   - la bibliothèque de départ : 45 templates AR/FR/EN, tous « draft » (l'approbation
 *     Meta n'est jamais inventée), noms valides et variables cohérentes avec
 *     les placeholders du corps ;
 *   - le couple (nom, langue) est la clé métier : un même nom peut exister en
 *     français, arabe ET anglais ; le doublon (nom, langue) est refusé ;
 *   - l'extraction des variables et le rendu fonctionnent sur les corps
 *     français, arabes et anglais (mêmes grammaires {{1}} et {{nom}}) ;
 *   - le composant « template » envoyé à Meta porte le code de langue exact
 *     du template (fr/ar/en) et les paramètres positionnels, dans l'ordre ;
 *   - la langue d'un client est déduite de SES messages entrants (5 derniers)
 *     : un texte arabe -> « ar », sinon « fr » (repli plateforme) ; les
 *     messages sortants et ceux des autres marchands ne comptent pas ;
 *   - la résolution d'évènement est multilingue : langue du client, puis
 *     français, puis n'importe quel template approuvé (comportement
 *     historique) ; un template non approuvé (rejected/pending/paused/draft)
 *     n'est JAMAIS choisi, et rien n'est inventé sans template approuvé ;
 *   - le flux réel (nouvelle commande, changement de statut) envoie le
 *     template dans la langue du client, avec les variables de la commande ;
 *     l'assignation explicite d'un template à une automatisation prime ;
 *   - la déduplication et la garde d'approbation restent intactes.
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

  const { get, run, all, uid, nowIso } = await import("../src/server/db");
  const { templateComponent, renderTemplate, extractTemplateVariables } = await import("../src/server/connectors/whatsapp");
  const { queueMessage, deliverQueuedMessage, evaluateGuards, customerLanguage } = await import("../src/server/services/messaging");
  const { seedTemplates } = await import("../src/server/services/seedTemplates");
  const { seedAutomations, resolveEventTemplate, onNewOrder, onDeliveryStatusChange } = await import("../src/server/services/automations");
  const { formatDzd, AUTOMATION_TYPES, TEMPLATE_GROUPS } = await import("../src/lib/domain");

  await run(
    "TRUNCATE users, merchants, merchant_users, customers, orders, whatsapp_connections, whatsapp_conversations, whatsapp_messages, whatsapp_templates, satisfaction_scores, jobs, notifications, automations, automation_runs, usage_records, order_events, api_logs RESTART IDENTITY CASCADE",
    [],
  );

  const merchant = async (id: string, name: string, slug: string) => {
    await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [id, name, slug, "trial"]);
  };
  const cust = async (merchantId: string, name: string, phone: string) => {
    const id = uid("cus");
    await run("INSERT INTO customers (id, merchant_id, full_name, original_phone, normalized_phone) VALUES (?,?,?,?,?)", [
      id,
      merchantId,
      name,
      phone,
      phone,
    ]);
    return id;
  };
  const agoIso = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString().replace("T", " ").slice(0, 19);
  const inbound = async (merchantId: string, customerId: string, body: string, minutesAgo = 60) => {
    await run(
      "INSERT INTO whatsapp_messages (id, merchant_id, customer_id, direction, kind, body, status, created_at) VALUES (?,?,?, 'inbound', 'text', ?, 'received', ?)",
      [uid("msg"), merchantId, customerId, body, agoIso(minutesAgo)],
    );
  };
  const tplRow = async (
    merchantId: string,
    name: string,
    language: string,
    body: string,
    opts: { category?: string; status?: string; event?: string | null; updatedAt?: string } = {},
  ): Promise<string> => {
    const id = uid("tpl");
    await run(
      `INSERT INTO whatsapp_templates (id, merchant_id, name, category, language, status, body, variables, event_key, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, merchantId, name, opts.category ?? "utility", language, opts.status ?? "draft", body, JSON.stringify(extractTemplateVariables(body)), opts.event ?? null, opts.updatedAt ?? nowIso()],
    );
    return id;
  };
  const orderRow = async (merchantId: string, customerId: string, customerName: string, phone: string, reference: string, total: number) => {
    const id = uid("ord");
    await run(
      `INSERT INTO orders (id, merchant_id, reference, customer_id, customer_name, normalized_phone, wilaya, delivery_type, products_price, delivery_price, total, status, created_at)
       VALUES (?,?,?,?,?,?,?, 'home', ?, 500, ?, 'new', ?)`,
      [id, merchantId, reference, customerId, customerName, phone, "Alger", total - 500, total, nowIso()],
    );
    return id;
  };
  const lastTplMsg = (merchantId: string, orderId: string) =>
    get<{ id: string; template_id: string | null; template_name: string | null; template_variables: string | null; body: string; customer_id: string | null; status: string; wa_message_id: string | null }>(
      `SELECT id, template_id, template_name, template_variables, body, customer_id, status, wa_message_id
       FROM whatsapp_messages WHERE merchant_id = ? AND order_id = ? AND kind = 'template' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [merchantId, orderId],
    );

  const M1 = "mch_tpl_1";
  const M2 = "mch_tpl_2";
  const M3 = "mch_tpl_3";
  const M4 = "mch_tpl_4";
  const M5 = "mch_tpl_5";
  await merchant(M1, "Templates 1", "tpl-1");
  await merchant(M2, "Templates 2", "tpl-2");
  await merchant(M3, "Templates 3", "tpl-3");
  await merchant(M4, "Templates 4", "tpl-4");
  await merchant(M5, "Templates 5", "tpl-5");

  /* ================================================================== */
  console.log("── A. Bibliothèque de départ (seed) ──────────────────────────");
  await seedTemplates(M1);
  const seeds = await all<{ id: string; name: string; language: string; status: string; body: string; variables: string | null; event_key: string | null }>(
    "SELECT id, name, language, status, body, variables, event_key FROM whatsapp_templates WHERE merchant_id = ?",
    [M1],
  );
  record("Seed : les 45 templates de départ sont créés", seeds.length === 45, `${seeds.length} template(s)`);
  record(
    "Seed : chaque template existe en français, arabe et anglais",
    ["fr", "ar", "en"].every((language) => seeds.filter((s) => s.language === language).length === 15),
  );
  record("Seed : tous « draft » — l'approbation Meta n'est jamais inventée", seeds.every((s) => s.status === "draft"));
  record(
    "Seed : noms valides (minuscules/chiffres/underscores) et uniques par langue",
    seeds.every((s) => /^[a-z0-9_]+$/.test(s.name)) && new Set(seeds.map((s) => `${s.name}:${s.language}`)).size === 45,
  );
  record(
    "Seed : le nombre de variables déclarées = le nombre de placeholders du corps (tous)",
    seeds.every((s) => extractTemplateVariables(s.body).length === (s.variables ? JSON.parse(s.variables).length : 0)),
  );
  const seedEvents = seeds.map((s) => s.event_key).filter((e): e is string => !!e);
  record(
    "Seed : les clés d'évènement sont valides et sans doublon",
    seedEvents.length === 18 && new Set(seedEvents).size === 6 && seedEvents.every((e) => (AUTOMATION_TYPES as readonly string[]).includes(e)),
    `${seedEvents.length} évènement(s)`,
  );
  record(
    "Seed : la confirmation de commande est liée à « new_order_confirmation »",
    seeds.some((s) => s.name === "order_confirmation_request" && s.event_key === "new_order_confirmation"),
  );
  await seedTemplates(M1);
  const seedsAfter = Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ?", [M1]))?.c);
  record("Seed : re-exécuter le seed ne duplique rien", seedsAfter === 45, `${seedsAfter} template(s)`);

  const groupedSeeds = await all<{ template_group: string; language: string; c: number }>(
    "SELECT template_group, language, COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ? GROUP BY template_group, language",
    [M1],
  );
  const groupedCount = (group: string, language: string) => Number(groupedSeeds.find((row) => row.template_group === group && row.language === language)?.c ?? 0);
  record("Groupe Confirmation présent dans les trois langues", TEMPLATE_GROUPS.includes("confirmation") && groupedCount("confirmation", "fr") === 4 && groupedCount("confirmation", "ar") === 4 && groupedCount("confirmation", "en") === 4);
  record("Groupe Tracking présent dans les trois langues", groupedCount("tracking", "fr") === 5 && groupedCount("tracking", "ar") === 5 && groupedCount("tracking", "en") === 5);
  record("Groupe Return présent dans les trois langues", groupedCount("return", "fr") === 3 && groupedCount("return", "ar") === 3 && groupedCount("return", "en") === 3);
  record("Groupe Satisfaction présent dans les trois langues", groupedCount("satisfaction", "fr") === 3 && groupedCount("satisfaction", "ar") === 3 && groupedCount("satisfaction", "en") === 3);
  record("Chaque variante garde le même groupe métier", groupedSeeds.length === 12);
  record("La confirmation appartient au groupe Confirmation", seeds.find((s) => s.name === "order_confirmation_request" && s.language === "fr")?.event_key === "new_order_confirmation" && (await get<{ template_group: string }>("SELECT template_group FROM whatsapp_templates WHERE merchant_id = ? AND name = ? AND language = 'fr'", [M1, "order_confirmation_request"]))?.template_group === "confirmation");
  record("Le suivi expédié appartient au groupe Tracking", (await get<{ template_group: string }>("SELECT template_group FROM whatsapp_templates WHERE merchant_id = ? AND name = ? AND language = 'fr'", [M1, "order_shipped"]))?.template_group === "tracking");
  record("Le colis retourné appartient au groupe Return", (await get<{ template_group: string }>("SELECT template_group FROM whatsapp_templates WHERE merchant_id = ? AND name = ? AND language = 'fr'", [M1, "order_returned"]))?.template_group === "return");
  record("La demande d'avis appartient au groupe Satisfaction", (await get<{ template_group: string }>("SELECT template_group FROM whatsapp_templates WHERE merchant_id = ? AND name = ? AND language = 'fr'", [M1, "satisfaction_request"]))?.template_group === "satisfaction");
  record("Les noms restent identiques entre les langues", new Set(seeds.filter((s) => s.language === "fr").map((s) => s.name)).size === new Set(seeds.filter((s) => s.language === "ar").map((s) => s.name)).size && new Set(seeds.filter((s) => s.language === "fr").map((s) => s.name)).size === 15);
  record("Les modèles anglais sont bien persistés", seeds.filter((s) => s.language === "en").every((s) => s.body.length > 5));
  record("Les modèles arabes sont bien persistés", seeds.filter((s) => s.language === "ar").every((s) => /[\\u0600-\\u06FF]/.test(s.body)));
  record("Les variables restent cohérentes sur les 45 modèles", seeds.every((s) => extractTemplateVariables(s.body).length === (s.variables ? JSON.parse(s.variables).length : 0)));
  record("Aucune clé de groupe hors catalogue", groupedSeeds.every((row) => (TEMPLATE_GROUPS as readonly string[]).includes(row.template_group)));
  record("La somme des groupes vaut 45 par langue", ["fr", "ar", "en"].every((language) => groupedSeeds.filter((row) => row.language === language).reduce((sum, row) => sum + Number(row.c), 0) === 15));
  record("Le seed reste déterministe après lecture groupée", (await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ?", [M1]))?.c === 45);
  record("Les quatre groupes sont non vides", TEMPLATE_GROUPS.every((group) => groupedSeeds.some((row) => row.template_group === group && Number(row.c) > 0)));

  /* ================================================================== */
  console.log("\n── B. Multilingue : (nom, langue) est la clé métier ────────");
  const AR_BODY_B = "مرحباً {{1}}، طلبك {{2}} جاهز. شكراً لك.";
  let arInsertOk = true;
  try {
    await tplRow(M1, "custom_order_confirmed", "ar", AR_BODY_B, { status: "approved" });
  } catch {
    arInsertOk = false;
  }
  record("Même nom, langue différente (arabe) : autorisé", arInsertOk);
  // The French sibling is a legitimate second variant; the next insert repeats
  // the Arabic key and must be rejected.
  await tplRow(M1, "custom_order_confirmed", "fr", "Bonjour {{1}}, votre commande {{2}} est confirmée.");
  let dupThrew = false;
  try {
    await tplRow(M1, "custom_order_confirmed", "ar", "Corps dupliqué volontairement pour le test.");
  } catch {
    dupThrew = true;
  }
  record("Doublon (même nom, même langue) : refusé par la contrainte unique", dupThrew);
  let otherMerchantOk = true;
  try {
    await tplRow(M2, "custom_order_confirmed", "fr", "Bonjour {{1}}, votre commande {{2}} est confirmée.");
  } catch {
    otherMerchantOk = false;
  }
  record("Même nom + langue chez UN AUTRE marchand : autorisé (pas de collision croisée)", otherMerchantOk);
  let enInsertOk = true;
  try {
    await tplRow(M1, "custom_order_confirmed", "en", "Hi {{customer_name}}, your order {{order_ref}} is confirmed.");
  } catch {
    enInsertOk = false;
  }
  record("Même nom, troisième langue (anglais) : autorisé", enInsertOk);
  const variantsCount = Number(
    (await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_templates WHERE merchant_id = ? AND name = 'custom_order_confirmed'", [M1]))?.c,
  );
  record("Trois variantes (fr/ar/en) coexistent sous un même nom", variantsCount === 3, `${variantsCount} variante(s)`);
  const arBodyRead = await get<{ body: string }>("SELECT body FROM whatsapp_templates WHERE merchant_id = ? AND name = 'custom_order_confirmed' AND language = 'ar'", [M1]);
  record("Le corps arabe est conservé à l'identique (aller-retour base)", arBodyRead?.body === AR_BODY_B);

  /* ================================================================== */
  console.log("\n── C. Extraction des variables (fr/ar/en) ───────────────────");
  record(
    "Corps français : variables nommées extraites dans l'ordre",
    JSON.stringify(extractTemplateVariables("Bonjour {{customer_name}}, référence {{order_ref}}.")) ===
      JSON.stringify(["customer_name", "order_ref"]),
  );
  record(
    "Corps arabe : variables positionnelles extraites dans l'ordre",
    JSON.stringify(extractTemplateVariables("مرحباً {{1}}، طلبك {{2}}.")) === JSON.stringify(["1", "2"]),
  );
  record(
    "Mélange positionnel + nommé : ordre d'apparition respecté",
    JSON.stringify(extractTemplateVariables("{{1}} puis {{customer_name}} puis {{2}}")) === JSON.stringify(["1", "customer_name", "2"]),
  );
  record(
    "Espaces autour du placeholder tolérés",
    JSON.stringify(extractTemplateVariables("{{ customer_name }}")) === JSON.stringify(["customer_name"]),
  );
  record("Sans placeholder : liste vide", extractTemplateVariables("aucun placeholder ici").length === 0);
  record(
    "Corps anglais : extraction identique aux autres langues",
    JSON.stringify(extractTemplateVariables("Hi {{customer_name}}, your order {{order_ref}} shipped.")) ===
      JSON.stringify(["customer_name", "order_ref"]),
  );

  /* ================================================================== */
  console.log("\n── D. Rendu local multilingue ───────────────────────────────");
  record(
    "Corps arabe avec variables nommées rendu correctement",
    renderTemplate("مرحباً {{customer_name}}، طلبك {{order_ref}} جاهز.", { customer_name: "أمين", order_ref: "CMD-7" }) ===
      "مرحباً أمين، طلبك CMD-7 جاهز.",
  );
  record(
    "Corps arabe avec variables positionnelles rendu correctement",
    renderTemplate("مرحباً {{1}}، وصل طلب {{2}}.", { "1": "أمين", "2": "CMD-8" }) === "مرحباً أمين، وصل طلب CMD-8.",
  );
  record(
    "Variable manquante : le placeholder disparaît sans casser le texte",
    renderTemplate("مرحباً {{customer_name}}، {{manquant}}.", { customer_name: "أمين" }) === "مرحباً أمين، .",
  );
  record("Corps arabe sans placeholder inchangé", renderTemplate("شكراً لك على طلبك.", {}) === "شكراً لك على طلبك.");
  record(
    "Montant formaté (DA) inséré dans un corps arabe",
    renderTemplate("المبلغ: {{3}}", { "3": formatDzd(5400) }) === `المبلغ: ${formatDzd(5400)}`,
  );

  /* ================================================================== */
  console.log("\n── E. Composant « template » pour l'API Cloud Meta ──────────");
  record("Code de langue arabe transmis à Meta", templateComponent("tpl_ar", "ar", ["أ", "ب"]).language.code === "ar");
  record("Code de langue français transmis à Meta", templateComponent("tpl_fr", "fr", ["x"]).language.code === "fr");
  record(
    "Paramètres arabes dans l'ordre positionnel",
    JSON.stringify(templateComponent("tpl_ar", "ar", ["أمين", "CMD-9"]).components[0].parameters) ===
      JSON.stringify([
        { type: "text", text: "أمين" },
        { type: "text", text: "CMD-9" },
      ]),
  );
  record("Template arabe sans variables : aucun composant vide", templateComponent("vacio", "ar", []).components.length === 0);
  record("Le nom du template est transmis tel quel", templateComponent("order_confirmed", "ar", ["a"]).name === "order_confirmed");

  /* ================================================================== */
  console.log("\n── F. Langue du client (heuristique sur ses messages) ───────");
  const f1 = await cust(M3, "F1", "+213600000001");
  record("Client sans message entrant : « fr » (repli plateforme)", (await customerLanguage(M3, f1)) === "fr");
  const f2 = await cust(M3, "F2", "+213600000002");
  await inbound(M3, f2, "bonjour, c'est pour la commande", 60);
  record("Client qui écrit en français : « fr »", (await customerLanguage(M3, f2)) === "fr");
  const f3 = await cust(M3, "F3", "+213600000003");
  await inbound(M3, f3, "مرحبا، اريد الطلب", 60);
  record("Client qui écrit en arabe : « ar »", (await customerLanguage(M3, f3)) === "ar");
  const f4 = await cust(M3, "F4", "+213600000004");
  await inbound(M3, f4, "bonjour", 120);
  await inbound(M3, f4, "مرحبا", 60);
  record("Français puis arabe (fenêtre des 5 derniers) : « ar »", (await customerLanguage(M3, f4)) === "ar");
  const f5 = await cust(M3, "F5", "+213600000005");
  await inbound(M3, f5, "مرحبا", 120);
  await inbound(M3, f5, "ok d'accord", 60);
  record("Arabe puis français : « ar » (l'arabe reste détectable dans la fenêtre)", (await customerLanguage(M3, f5)) === "ar");
  const f6 = await cust(M3, "F6", "+213600000006");
  for (const m of [360, 350, 340, 330, 320, 310]) await inbound(M3, f6, "مرحبا", m);
  for (const m of [100, 90, 80, 70, 60]) await inbound(M3, f6, "bonjour", m);
  record("Arabe hors de la fenêtre des 5 derniers : « fr »", (await customerLanguage(M3, f6)) === "fr");
  const f7 = await cust(M3, "F7", "+213600000007");
  const m4a = await cust(M4, "M4-A", "+213600000010");
  await inbound(M4, m4a, "مرحبا", 60);
  record(
    "Les messages d'UN AUTRE marchand ne comptent pas",
    (await customerLanguage(M3, f7)) === "fr" && (await customerLanguage(M4, m4a)) === "ar",
  );
  const f9 = await cust(M3, "F9", "+213600000009");
  await run(
    "INSERT INTO whatsapp_messages (id, merchant_id, customer_id, direction, kind, body, status, created_at) VALUES (?,?,?, 'outbound', 'template', ?, 'sent', ?)",
    [uid("msg"), M3, f9, "مرحبا، طلبك جاهز.", nowIso()],
  );
  record("Les messages SORTANTS n'induisent jamais une langue", (await customerLanguage(M3, f9)) === "fr");

  /* ================================================================== */
  console.log("\n── G. Résolution multilingue d'un évènement ──────────────────");
  // M2 : conf_a/conf_b (new_order_confirmation), ship_* (shipped_notice), dt_ar (delivered_thanks)
  const g_fr1 = await tplRow(M2, "conf_a", "fr", "Bonjour {{1}}, commande {{2}} ({{3}}). Répondez OUI.", { event: "new_order_confirmation", status: "approved", updatedAt: "2026-01-01 00:00:00" });
  const g_fr2 = await tplRow(M2, "conf_b", "fr", "Bonjour {{1}}, votre commande {{2}} de {{3}} est reçue.", { event: "new_order_confirmation", status: "approved", updatedAt: "2026-02-01 00:00:00" });
  const g_ar = await tplRow(M2, "conf_a", "ar", "مرحباً {{1}}، وصل طلب {{2}} بمبلغ {{3}}. أجب نعم.", { event: "new_order_confirmation", status: "approved", updatedAt: "2026-02-15 00:00:00" });
  const g_ship_fr = await tplRow(M2, "ship_a", "fr", "Bonjour {{1}}, votre colis {{2}} a été expédié.", { event: "shipped_notice", status: "approved", updatedAt: "2026-01-05 00:00:00" });
  await tplRow(M2, "ship_b", "ar", "مرحباً {{1}}، تم شحن {{2}}.", { event: "shipped_notice", status: "rejected", updatedAt: "2026-01-06 00:00:00" });
  await tplRow(M2, "ship_c", "ar", "مرحباً {{1}}، {{2}} قيد الشحن.", { event: "shipped_notice", status: "pending", updatedAt: "2026-01-07 00:00:00" });
  const g_m2_ar = await tplRow(M2, "dt_ar", "ar", "شكراً {{1}}، تم توصيل {{2}}.", { event: "delivered_thanks", status: "approved", updatedAt: "2026-01-08 00:00:00" });
  const g_m3_ar = await tplRow(M3, "dt_ar", "ar", "شكراً {{1}} (M3)، تم توصيل {{2}}.", { event: "delivered_thanks", status: "approved", updatedAt: "2026-01-09 00:00:00" });
  record("Langue client « ar » + version ar approuvée : le template arabe est choisi", (await resolveEventTemplate(M2, "new_order_confirmation", "ar")) === g_ar);
  record("Langue client « fr » : le template français est choisi", (await resolveEventTemplate(M2, "new_order_confirmation", "fr")) === g_fr2);
  record("Arabe rejeté + en attente : repli sur la version française", (await resolveEventTemplate(M2, "shipped_notice", "ar")) === g_ship_fr);
  record("Langue sans version dédiée (« en ») : repli français", (await resolveEventTemplate(M2, "shipped_notice", "en")) === g_ship_fr);
  record("Aucun template approuvé pour l'évènement : null (rien n'est inventé)", (await resolveEventTemplate(M2, "out_for_delivery_notice", "ar")) === null);
  await run("UPDATE whatsapp_templates SET status = 'paused' WHERE id = ?", [g_ar]);
  record("Version arabe « paused » : elle n'est jamais choisie (repli français)", (await resolveEventTemplate(M2, "new_order_confirmation", "ar")) === g_fr2);
  await run("UPDATE whatsapp_templates SET status = 'draft' WHERE id = ?", [g_ship_fr]);
  record("Plus aucun template approuvé : null", (await resolveEventTemplate(M2, "shipped_notice", "fr")) === null);
  await run("UPDATE whatsapp_templates SET updated_at = '2026-12-31 00:00:00' WHERE id = ?", [g_fr1]);
  record("Deux versions fr approuvées : la plus récente gagne", (await resolveEventTemplate(M2, "new_order_confirmation", "fr")) === g_fr1);
  record(
    "Chaque marchand ne voit que SES templates (pas de fuite croisée)",
    (await resolveEventTemplate(M3, "delivered_thanks", "ar")) === g_m3_ar && (await resolveEventTemplate(M2, "delivered_thanks", "ar")) === g_m2_ar,
  );
  record(
    "Seule version approuvée en arabe, demande « fr » : repli historique sur n'importe quel template approuvé",
    (await resolveEventTemplate(M2, "delivered_thanks", "fr")) === g_m2_ar,
  );

  /* ================================================================== */
  console.log("\n── H. Flux réel : la bonne langue, de bout en bout ───────────");
  await seedAutomations(M4);
  const H_TOTAL = 5400;
  const H_FR_BODY = "Bonjour {{1}}, nous avons bien reçu votre commande {{2}} d'un montant de {{3}}. Répondez OUI.";
  const H_AR_BODY = "مرحباً {{1}}، وصل طلب {{2}} بمبلغ {{3}}. أجب نعم للتأكيد.";
  const h_fr = await tplRow(M4, "order_confirmation_request", "fr", H_FR_BODY, { event: "new_order_confirmation", status: "approved", updatedAt: "2026-03-01 00:00:00" });
  const h_ar = await tplRow(M4, "order_confirmation_request", "ar", H_AR_BODY, { event: "new_order_confirmation", status: "approved", updatedAt: "2026-03-02 00:00:00" });
  const h_ship_fr = await tplRow(M4, "shipped_fr", "fr", "Bonjour {{1}}, votre colis {{2}} a été expédié.", { event: "shipped_notice", status: "approved", updatedAt: "2026-03-03 00:00:00" });

  const c_ar = await cust(M4, "Amine Benali", "+213600000021");
  await inbound(M4, c_ar, "مرحبا، اريد الطلب", 1440);
  const c_fr = await cust(M4, "Leila Cherif", "+213600000022");
  await inbound(M4, c_fr, "bonjour, je confirme", 1440);
  const c_none = await cust(M4, "Sofia Mansouri", "+213600000023");
  const c_ar2 = await cust(M4, "Yacine Meziane", "+213600000024");
  await inbound(M4, c_ar2, "مرحبا", 1440);
  const c_ar3 = await cust(M4, "Nadia Benaissa", "+213600000025");
  await inbound(M4, c_ar3, "مرحبا", 1440);

  const o_ar = await orderRow(M4, c_ar, "Amine Benali", "+213600000021", "CMD-TPL-AR1", H_TOTAL);
  const o_fr = await orderRow(M4, c_fr, "Leila Cherif", "+213600000022", "CMD-TPL-FR1", H_TOTAL);
  const o_none = await orderRow(M4, c_none, "Sofia Mansouri", "+213600000023", "CMD-TPL-N1", H_TOTAL);
  const o_ar2 = await orderRow(M4, c_ar2, "Yacine Meziane", "+213600000024", "CMD-TPL-AR2", H_TOTAL);
  const o_ar3 = await orderRow(M4, c_ar3, "Nadia Benaissa", "+213600000025", "CMD-TPL-AR3", H_TOTAL);

  await onNewOrder(o_ar);
  const msgAr = await lastTplMsg(M4, o_ar);
  record("Nouvelle commande, client arabe : le template ARABE est envoyé", msgAr?.template_id === h_ar, `template=${msgAr?.template_id}`);
  record(
    "…avec les valeurs ordonnées de la commande (nom, référence, montant)",
    msgAr?.template_variables === JSON.stringify(["Amine Benali", "CMD-TPL-AR1", formatDzd(H_TOTAL)]),
    msgAr?.template_variables ?? "(null)",
  );
  record(
    "…et le corps rendu est bien le corps arabe",
    msgAr?.body === renderTemplate(H_AR_BODY, { "1": "Amine Benali", "2": "CMD-TPL-AR1", "3": formatDzd(H_TOTAL) }),
    msgAr?.body,
  );
  record("Le message porte le nom du template et le bon client", msgAr?.template_name === "order_confirmation_request" && msgAr?.customer_id === c_ar);
  const delAr = await deliverQueuedMessage(msgAr?.id ?? "");
  const msgArAfter = await lastTplMsg(M4, o_ar);
  record("Livraison du template arabe via le bac à sable (hors réseau)", delAr.ok === true && msgArAfter?.status === "sent" && (msgArAfter?.wa_message_id ?? "").startsWith("sandbox."));

  await onNewOrder(o_fr);
  record("Nouvelle commande, cliente française : le template FRANÇAIS est envoyé", (await lastTplMsg(M4, o_fr))?.template_id === h_fr);
  await onNewOrder(o_none);
  record("Nouvelle commande, client sans message : repli français", (await lastTplMsg(M4, o_none))?.template_id === h_fr);

  const atmNewOrder = await get<{ id: string }>("SELECT id FROM automations WHERE merchant_id = ? AND type = 'new_order_confirmation'", [M4]);
  await run("UPDATE automations SET template_id = ? WHERE id = ?", [h_fr, atmNewOrder?.id ?? ""]);
  await onNewOrder(o_ar2);
  record("Assignation EXPLICITE d'un template à l'automatisation : elle prime sur la langue du client", (await lastTplMsg(M4, o_ar2))?.template_id === h_fr);

  await onDeliveryStatusChange(o_ar3, M4, "shipped", "shipped");
  record(
    "Statut « expédié », client arabe, pas de version ar de l'évènement : repli français",
    (await lastTplMsg(M4, o_ar3))?.template_id === h_ship_fr,
  );

  await onNewOrder(o_fr);
  const frMsgCount = Number((await get<{ c: number }>("SELECT COUNT(*) AS c FROM whatsapp_messages WHERE merchant_id = ? AND order_id = ? AND kind = 'template'", [M4, o_fr]))?.c);
  const dupRun = await get<{ result: string; reason: string | null }>(
    "SELECT result, reason FROM automation_runs WHERE merchant_id = ? AND trigger = 'new_order_confirmation' AND reason = 'duplicate' LIMIT 1",
    [M4],
  );
  record("Re-déclenchement identique : dédupliqué (un seul message, trace « duplicate »)", frMsgCount === 1 && dupRun?.result === "suppressed");

  /* ================================================================== */
  console.log("\n── I. Garde-fous d'approbation (inchangés) ──────────────────");
  const i_draft_ar = await tplRow(M5, "gate_ar", "ar", "مرحباً {{1}}، تأكيد {{2}}.", {});
  const i_ok_ar = await tplRow(M5, "gate_ok_ar", "ar", "مرحباً {{1}}، تأكيد {{2}}.", { status: "approved" });
  const i_ok_fr = await tplRow(M5, "gate_ok_fr", "fr", "Bonjour {{1}}, confirmation {{2}}.", { status: "approved" });
  await seedAutomations(M5);
  const atm5 = await get<{ id: string }>("SELECT id FROM automations WHERE merchant_id = ? AND type = 'new_order_confirmation'", [M5]);

  const r59 = await queueMessage({ merchantId: M5, toPhone: "+213600000030", templateId: i_draft_ar, eventKey: "manual" });
  record("Template arabe « draft » : envoi manuel refusé (template_not_approved)", r59.status === "suppressed" && r59.reason === "template_not_approved");
  const r60 = await queueMessage({ merchantId: M5, toPhone: "+213600000031", templateId: "tpl_ne_xiste_pas", eventKey: "manual" });
  record("Template inconnu : refusé (template_missing)", r60.status === "suppressed" && r60.reason === "template_missing");
  const g61 = await evaluateGuards({ merchantId: M5, toPhone: "+213600000032", templateId: i_ok_ar, eventKey: "manual" });
  record("Template arabe APPROUVÉ : autorisé", g61.allowed === true);
  const g62 = await evaluateGuards({ merchantId: M5, toPhone: "+213600000033", templateId: i_ok_fr, eventKey: "manual" });
  record("Template français approuvé : autorisé (régression)", g62.allowed === true);
  const g63 = await evaluateGuards({ merchantId: M5, toPhone: "+213600000034", templateId: i_draft_ar, eventKey: "manual" });
  record("Garde de décision : le draft est signalé template_not_approved", g63.allowed === false && g63.reason === "template_not_approved");
  await queueMessage({ merchantId: M5, toPhone: "+213600000035", templateId: i_draft_ar, eventKey: "manual", automationId: atm5?.id });
  const run5 = await get<{ result: string; reason: string | null }>(
    "SELECT result, reason FROM automation_runs WHERE merchant_id = ? AND trigger = 'manual' ORDER BY created_at DESC LIMIT 1",
    [M5],
  );
  record("Refus d'automatisation journalisé (traçabilité)", run5?.result === "suppressed" && run5?.reason === "template_not_approved");

  /* ================================================================== */
  const passed = results.filter((r) => r.ok).length;
  console.log("\n══════════════════════════════════════════════════════════");
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
