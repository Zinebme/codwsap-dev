/**
 * Tests du catalogue et des moteurs de connecteurs de livraison.
 *
 *   npm run test:delivery
 *
 * Ces tests sont HORS LIGNE : ils ne contactent aucun transporteur. Ils
 * vérifient ce qui est vérifiable sans identifiants réels :
 *
 *   - intégrité du catalogue (identifiants uniques, moteur connu, etc.) ;
 *   - chaque société est bien desservie par le moteur attendu ;
 *   - les capacités annoncées à l'interface correspondent au moteur ;
 *   - les sociétés non documentées sont explicitement signalées ;
 *   - les champs d'identifiants sont cohérents ;
 *   - la normalisation des statuts couvre le vocabulaire réel des
 *     transporteurs algériens (français, arabe, anglais) ;
 *   - aucun connecteur ne peut fabriquer une expédition sans identifiants.
 *
 * Ce qui NÉCESSITE des identifiants réels (création d'expédition, suivi,
 * annulation en production) n'est PAS testé ici et n'est pas revendiqué.
 */
import {
  CARRIERS,
  ENGINE_CAPABILITIES,
  ENGINE_LABELS,
  buildConnector,
  capabilitiesForCarrier,
  carrierById,
  engineOf,
  requiresDocumentation,
} from "../src/server/connectors/delivery";
import type { DeliveryStatus } from "../src/lib/domain";

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const MERCHANT = "mch_test";

async function main() {
  console.log("\n── Intégrité du catalogue ──────────────────────────────────");

  const ids = CARRIERS.map((c) => c.id);
  record("Identifiants uniques", new Set(ids).size === ids.length, `${ids.length} sociétés`);

  record(
    "Toutes les sociétés ont un moteur connu",
    CARRIERS.every((c) => c.engine in ENGINE_CAPABILITIES),
    `${new Set(CARRIERS.map((c) => c.engine)).size} moteurs`,
  );

  record(
    "Toutes les sociétés ont un nom et une famille",
    CARRIERS.every((c) => c.name.trim().length > 1 && !!c.family),
  );

  record("Chaque moteur a un libellé", Object.keys(ENGINE_CAPABILITIES).every((e) => !!ENGINE_LABELS[e as keyof typeof ENGINE_LABELS]));

  // Les sociétés exigées par le cahier des charges doivent être présentes.
  const required = [
    "Yalidine", "Yalitec", "Guepex", "Easy & Speed", "Economiqua", "We Can Services",
    "Noest", "Maystro Delivery", "ZR Express", "ABEX Express", "Zimou Express", "Colivraison",
    "E-COM Delivery", "Elogistia", "Near Delivery", "MDM Express", "Leopard Express",
    "Colilog Express", "Flash Delivery", "Procolis",
    "DHD", "Conexlog", "MSM Go", "Rex Livraison", "WorldExpress", "Med Express", "Colireli",
    "PDEX", "Anderson Delivery", "OM Express", "Packers", "Swift Express", "IMIR Logistics",
  ];
  const names = new Set(CARRIERS.map((c) => c.name));
  const missing = required.filter((r) => !names.has(r));
  record("Toutes les sociétés demandées sont au catalogue", missing.length === 0, missing.length ? `manquantes : ${missing.join(", ")}` : `${required.length} vérifiées`);

  record(
    "Connecteurs génériques présents (EcoTrack + personnalisé)",
    !!carrierById("ecotrack") && !!carrierById("custom"),
  );

  console.log("\n── Affectation aux moteurs ─────────────────────────────────");

  const expectEngine: Record<string, string> = {
    yalidine: "yalidine", yalitec: "yalidine", guepex: "yalidine",
    easy_speed: "yalidine", economiqua: "yalidine", we_can_services: "yalidine",
    procolis: "procolis", zrexpress: "procolis", abex: "procolis",
    leopard_express: "procolis", colilog_express: "procolis", flash_delivery: "procolis",
    ecotrack: "ecotrack", dhd: "ecotrack", conexlog: "ecotrack", msm_go: "ecotrack",
    rex_livraison: "ecotrack", worldexpress: "ecotrack", med_express: "ecotrack",
    colireli: "ecotrack", pdex: "ecotrack", anderson_delivery: "ecotrack",
    om_express: "ecotrack", packers: "ecotrack", swift_express: "ecotrack", imir_logistics: "ecotrack",
    noest: "custom", maystro: "custom", zimou_express: "custom", colivraison: "custom",
    ecom_delivery: "custom", elogistia: "custom", near_delivery: "custom",
    mdm_express: "custom", navex: "custom", custom: "custom",
  };
  const wrong = Object.entries(expectEngine).filter(([id, eng]) => engineOf(id) !== eng);
  record("Chaque société utilise le moteur attendu", wrong.length === 0,
    wrong.length ? wrong.map(([id, e]) => `${id}:${engineOf(id)}≠${e}`).join(", ") : `${Object.keys(expectEngine).length} vérifiées`);

  // La mutualisation est le cœur de l'architecture : peu de moteurs, beaucoup
  // de sociétés.
  const engines = new Set(CARRIERS.map((c) => c.engine));
  record("Mutualisation effective (moteurs ≪ sociétés)", engines.size <= 5 && CARRIERS.length >= 30,
    `${CARRIERS.length} sociétés pour ${engines.size} moteurs`);

  console.log("\n── Capacités ───────────────────────────────────────────────");

  record(
    "Les capacités exposées correspondent au moteur",
    CARRIERS.every((c) => {
      const fromCatalog = capabilitiesForCarrier(c.id);
      const fromEngine = ENGINE_CAPABILITIES[c.engine];
      return JSON.stringify(fromCatalog) === JSON.stringify(fromEngine);
    }),
  );

  // Le connecteur construit doit annoncer les mêmes capacités que le catalogue,
  // sinon l'interface promet des fonctions que le moteur n'exécute pas.
  const mismatched = CARRIERS.filter((c) => {
    const conn = buildConnector(c.id, {}, MERCHANT);
    const cat = capabilitiesForCarrier(c.id);
    return (
      conn.capabilities.supportsCreateShipment !== cat.createShipment ||
      conn.capabilities.supportsTracking !== cat.tracking ||
      conn.capabilities.supportsCancelShipment !== cat.cancelShipment ||
      conn.capabilities.supportsWebhooks !== cat.webhook ||
      conn.capabilities.supportsStatusPolling !== cat.polling
    );
  });
  record("Connecteur et catalogue annoncent les mêmes capacités", mismatched.length === 0,
    mismatched.length ? mismatched.map((m) => m.id).join(", ") : `${CARRIERS.length} sociétés`);

  record(
    "Aucune impression d'étiquette annoncée (non implémentée)",
    CARRIERS.every((c) => capabilitiesForCarrier(c.id).labelPrinting === false),
  );

  console.log("\n── Honnêteté des intégrations ──────────────────────────────");

  const unverified = CARRIERS.filter((c) => c.docStatus === "unverified");
  record("Les sociétés non vérifiées sont signalées", unverified.every((c) => requiresDocumentation(c.id)),
    `${unverified.length} signalées « documentation requise »`);

  record(
    "Les moteurs publics ne sont pas marqués « documentation requise »",
    ["yalidine", "procolis", "ecotrack", "custom", "sandbox"].every((id) => !requiresDocumentation(id)),
  );

  console.log("\n── Champs d'identifiants ───────────────────────────────────");

  const badFields = CARRIERS.filter((c) => {
    const conn = buildConnector(c.id, {}, MERCHANT);
    return conn.credentialFields.some((f) => !f.key || !f.label || !["text", "password", "url"].includes(f.type));
  });
  record("Tous les champs d'identifiants sont bien formés", badFields.length === 0,
    badFields.length ? badFields.map((c) => c.id).join(", ") : `${CARRIERS.length} sociétés`);

  // Les secrets doivent être saisis en champ masqué.
  const leaky = CARRIERS.filter((c) =>
    buildConnector(c.id, {}, MERCHANT).credentialFields.some(
      (f) => /token|key|secret|cle|password/i.test(f.key) && f.type !== "password",
    ),
  );
  record("Les secrets utilisent un champ masqué", leaky.length === 0,
    leaky.length ? leaky.map((c) => c.id).join(", ") : "");

  console.log("\n── Refus sans identifiants ─────────────────────────────────");

  // Un connecteur sans identifiants ne doit jamais prétendre être connecté.
  const realCarriers = CARRIERS.filter((c) => c.engine !== "sandbox");
  const falsePositives: string[] = [];
  for (const c of realCarriers) {
    const conn = buildConnector(c.id, {}, MERCHANT);
    const res = await conn.testConnection();
    if (res.ok) falsePositives.push(c.id);
  }
  record("Aucun transporteur n'est « connecté » sans identifiants", falsePositives.length === 0,
    falsePositives.length ? falsePositives.join(", ") : `${realCarriers.length} sociétés testées`);

  // Le message d'erreur doit guider le marchand, pas exposer une trace technique.
  const conn = buildConnector("noest", {}, MERCHANT);
  const res = await conn.testConnection();
  record("Message d'erreur explicite et non technique",
    !res.ok && res.message.length > 20 && !/undefined|null|Error:|stack/i.test(res.message),
    res.message);

  console.log("\n── Normalisation des statuts ───────────────────────────────");

  // Vocabulaire réellement rencontré chez les transporteurs algériens.
  const cases: [string, DeliveryStatus][] = [
    ["Livré", "delivered"],
    ["LIVRE", "delivered"],
    ["Delivered", "delivered"],
    ["تم التسليم", "delivered"],
    ["Retour vers vendeur", "returned"],
    ["Returned", "returned"],
    ["مرتجع", "returned"],
    ["Echec livraison", "delivery_failed"],
    ["Annulé", "delivery_failed"],
    ["Sorti en livraison", "out_for_delivery"],
    ["En cours de livraison", "out_for_delivery"],
    ["Vers Wilaya", "in_transit"],
    ["En transit", "in_transit"],
    ["Arrivé à l'agence", "at_agency"],
    ["Stopdesk", "at_agency"],
    ["Expédié", "shipped"],
    ["Ramassé", "shipped"],
    ["Confirmé", "accepted"],
    ["Nouveau colis", "created"],
  ];
  const c2 = buildConnector("ecotrack", {}, MERCHANT);
  const badNorm = cases.filter(([raw, expected]) => c2.normalizeStatus(raw) !== expected);
  record("Vocabulaire transporteur normalisé (fr/ar/en)", badNorm.length === 0,
    badNorm.length ? badNorm.map(([r, e]) => `"${r}"→${c2.normalizeStatus(r)}≠${e}`).join(", ") : `${cases.length} cas`);

  // Un statut inconnu ne doit jamais faire planter ni inventer « delivered ».
  const unknown = c2.normalizeStatus("statut totalement inconnu xyz");
  record("Statut inconnu traité prudemment", unknown === "submitted", `→ ${unknown}`);

  // La table de correspondance du marchand doit primer sur les mots-clés.
  const mapped = buildConnector("ecotrack", {}, MERCHANT, { "code-42": "at_agency" });
  record("La correspondance personnalisée du marchand prime", mapped.normalizeStatus("code-42") === "at_agency");

  console.log("\n── Analyse des webhooks ────────────────────────────────────");

  const eco = buildConnector("dhd", {}, MERCHANT);
  const parsed = eco.parseWebhook?.({ tracking: "ABC123", status: "Livré", updated_at: "2026-01-01 10:00:00" }) ?? [];
  record("Webhook EcoTrack analysé et normalisé",
    parsed.length === 1 && parsed[0].trackingNumber === "ABC123" && parsed[0].normalizedStatus === "delivered",
    JSON.stringify(parsed[0] ?? null));

  const empty = eco.parseWebhook?.({ garbage: true }) ?? [];
  record("Webhook malformé ignoré sans erreur", empty.length === 0);

  const custom = buildConnector("noest", {}, MERCHANT);
  const cparsed = custom.parseWebhook?.({ tracking_number: "XY9", state: "Retour" }) ?? [];
  record("Webhook personnalisé : champs alternatifs reconnus",
    cparsed.length === 1 && cparsed[0].normalizedStatus === "returned");

  console.log("\n── Bac à sable ─────────────────────────────────────────────");

  const sb = buildConnector("sandbox", {}, MERCHANT);
  const sbTest = await sb.testConnection();
  const sbShip = await sb.createShipment({
    reference: "CMD-1", customerName: "Test", phone: "+213550000000", wilaya: "Alger",
    commune: "Centre", address: "x", deliveryType: "home", productsLabel: "p", total: 1000,
  });
  record("Bac à sable utilisable sans identifiants", sbTest.ok && sbShip.ok);

  /* ------------------------------------------------------------------ */
  const failed = results.filter((r) => !r.ok);
  console.log("\n══════════════════════════════════════════════════════════");
  console.log(`  Connecteurs de livraison : ${results.length - failed.length}/${results.length}`);
  console.log("══════════════════════════════════════════════════════════");
  if (failed.length) {
    console.error(`\n${failed.length} test(s) en échec :`);
    for (const f of failed) console.error(`  - ${f.name} ${f.detail}`);
    process.exit(1);
  }
  console.log("\nCatalogue et moteurs de livraison vérifiés (hors ligne).\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
