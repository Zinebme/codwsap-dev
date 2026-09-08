/**
 * Tests du chemin de données Google Sheets (et CSV).
 *
 *   npm run test:sheets
 *
 * Tourne sur un VRAI PostgreSQL (binaires embarqués) avec les migrations
 * réelles. La couche RÉSEAU (API Sheets v4 / export CSV) exige des
 * identifiants et une vraie feuille : elle n'est PAS testée ici et aucun
 * succès n'est revendiqué. En revanche, tout ce qui arrive APRÈS le
 * téléchargement est vérifié :
 *
 *   - parsing CSV : détection du délimiteur, guillemets, champs vides ;
 *   - correspondance de colonnes par marchand (aucune structure imposée) ;
 *   - création de commandes avec normalisation du téléphone et des prix ;
 *   - détection domicile/bureau depuis le libellé de livraison ;
 *   - idempotence : re-synchroniser ne crée PAS de doublons ;
 *   - lignes invalides (nom/téléphone manquants) comptées et expliquées ;
 *   - détection d'en-têtes : renvoie les colonnes sans rien écrire ;
 *   - échec réseau : l'intégration passe en erreur, le marchand est alerté,
 *     et le statut repasse à « connected » au succès suivant.
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

  const { get, run, uid } = await import("../src/server/db");
  const { parseCsv, rowsToOrders, fetchSheetHeaders, syncGoogleSheet } = await import("../src/server/connectors/orders");
  const { encryptSecret } = await import("../src/server/crypto");

  await run(
    "TRUNCATE users, merchants, merchant_users, customers, orders, order_items, integrations, notifications, api_logs RESTART IDENTITY CASCADE",
    [],
  );
  const merchantId = "mch_sheets_test";
  await run("INSERT INTO merchants (id, name, slug, status, plan_code) VALUES (?,?,?,?, 'pro')", [merchantId, "Sheets Test", "sheets-test", "trial"]);

  console.log("── Parsing CSV ────────────────────────────────────────────");

  const rowsSemicolon = parseCsv('Nom;Téléphone;Total\n"Amine; B";0555000111;2500\n');
  record("Délimiteur point-virgule détecté", rowsSemicolon.length === 1 && rowsSemicolon[0]["Nom"] === "Amine; B", JSON.stringify(rowsSemicolon[0]));
  const rowsComma = parseCsv('a,b\n"x","y"\n');
  record("Guillemets et virgules gérés", rowsComma[0].a === "x" && rowsComma[0].b === "y");
  record("Fichier trop court : aucune ligne", parseCsv("une-seule-ligne").length === 0);
  const ragged = parseCsv("a,b\n1\n");
  record("Ligne courte : champ manquant vide", ragged[0].a === "1" && ragged[0].b === "");

  console.log("\n── Import avec correspondance de colonnes ─────────────────");

  const mapping = {
    order_id: "Réf",
    full_name: "Client",
    phone: "Tél",
    wilaya: "Wilaya",
    products_price: "Prix",
    delivery_price: "Livraison",
    total_price: "Total",
    delivery_place: "Type",
    quantity: "Qté",
    product_name: "Produit",
  };
  const rows = [
    { "Réf": "GS-1", Client: "Amine Boudiaf", "Tél": "0555000111", Wilaya: "Alger", Prix: "2 000 DA", Livraison: "500", Total: "2500", Type: "domicile", "Qté": "2", Produit: "Montre" },
    { "Réf": "GS-2", Client: "Leïla Hamdi", "Tél": "0666000222", Wilaya: "Oran", Prix: "1500", Livraison: "600", Total: "2100", Type: "bureau", "Qté": "1", Produit: "Sac" },
    { "Réf": "", Client: "", "Tél": "0555000333", Wilaya: "", Prix: "", Livraison: "", Total: "", Type: "", "Qté": "", Produit: "" },
  ];
  const res1 = await rowsToOrders(merchantId, rows, mapping, "google_sheets", "int_test");
  record("Commandes créées", res1.created === 2, `créées=${res1.created}`);
  record("Ligne invalide comptée (nom manquant)", res1.invalid === 1, `invalides=${res1.invalid}`);
  record("Détail d'erreur fourni", res1.errors.some((e) => e.includes("Ligne 4")), res1.errors[0] ?? "");

  const order1 = await get<{ customer_name: string; normalized_phone: string; delivery_type: string; total: number; quantity: number; products_price: number }>(
    "SELECT customer_name, normalized_phone, delivery_type, total, quantity, products_price FROM orders WHERE merchant_id = ? AND external_id = ?",
    [merchantId, "GS-1"],
  );
  record("Téléphone normalisé E.164", order1?.normalized_phone === "+213555000111", order1?.normalized_phone);
  record("Prix « 2 000 DA » parsé en 2000", order1?.products_price === 2000, String(order1?.products_price));
  record("Type domicile détecté", order1?.delivery_type === "home");
  const order2 = await get<{ delivery_type: string; total: number }>(
    "SELECT delivery_type, total FROM orders WHERE merchant_id = ? AND external_id = ?",
    [merchantId, "GS-2"],
  );
  record("Type bureau détecté depuis le libellé", order2?.delivery_type === "office");
  record("Total repris de la colonne mappée", order2?.total === 2100, String(order2?.total));

  console.log("\n── Idempotence : re-synchroniser ne double rien ───────────");

  const res2 = await rowsToOrders(merchantId, rows, mapping, "google_sheets", "int_test");
  record("Second passage : aucun doublon créé", res2.created === 0 && res2.duplicates === 2, `créées=${res2.created} doublons=${res2.duplicates}`);
  const count = await get<{ c: number }>("SELECT COUNT(*) AS c FROM orders WHERE merchant_id = ?", [merchantId]);
  record("Toujours 2 commandes en base", Number(count?.c) === 2, `n=${count?.c}`);

  console.log("\n── Détection d'en-têtes (lecture seule) ────────────────────");

  const integId = uid("int");
  await run(
    `INSERT INTO integrations (id, merchant_id, kind, label, status, settings, credentials_encrypted)
     VALUES (?,?, 'google_sheets', 'google_sheets', 'connected', ?, ?)`,
    [
      integId,
      merchantId,
      JSON.stringify({ spreadsheet_id: "id-feuille-test", sheet_name: "Commandes", gid: "0", mapping, auto_sync: false }),
      encryptSecret({ api_key: "cle-factice" }),
    ],
  );

  // Stub du fetch global : AUCUN réseau réel vers Google dans cette suite.
  // D'abord en échec (clé invalide, HTTP 403), puis en succès.
  const realFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  let googleapisOk = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requestedUrls.push(u);
    if (u.startsWith("https://sheets.googleapis.com/")) {
      if (!googleapisOk) return new Response(JSON.stringify({ error: { code: 403, message: "API key not valid" } }), { status: 403 });
      return new Response(
        JSON.stringify({ values: [["Réf", "Client", "Tél", "Prix", "Livraison", "Total", "Type"], ["GS-9", "Karim Benali", "0777000999", "3000", "400", "3400", "domicile"]] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.startsWith("https://docs.google.com/")) {
      return new Response("Réf,Client,Tél,Prix,Livraison,Total,Type\nGS-10,Nadia Cherif,0555000888,1200,400,1600,bureau\n", {
        status: 200,
        headers: { "Content-Type": "text/csv" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  const noHeaders = await fetchSheetHeaders("mch_inconnu");
  record("Sans intégration : erreur claire", noHeaders.ok === false);

  const detectedFail = await fetchSheetHeaders(merchantId);
  // Clé refusée : la lecture doit échouer proprement, sans inventer de colonnes.
  record("Feuille injoignable : échec propre, rien d'inventé", detectedFail.ok === false && !!detectedFail.error, detectedFail.ok ? "(succès inattendu)" : detectedFail.error.slice(0, 50));

  googleapisOk = true;
  const detected = await fetchSheetHeaders(merchantId);
  record(
    "En-têtes détectés depuis la feuille",
    detected.ok && detected.headers.length === 7 && detected.headers[0] === "Réf",
    detected.ok ? detected.headers.join(" · ") : detected.error,
  );

  console.log("\n── Synchronisation : états d'erreur et de succès ───────────");

  // Le stub de fetch est déjà en place (section précédente) : la clé est
  // rejetée tant que googleapisOk est faux. On repasse en échec pour tester
  // la transition d'état de l'intégration.
  googleapisOk = false;

  const failedSync = await syncGoogleSheet(merchantId, integId);
  record("Sync refusée (clé invalide) : ok=false", failedSync.ok === false);
  const integAfterFail = await get<{ status: string; last_error: string | null }>("SELECT status, last_error FROM integrations WHERE id = ?", [integId]);
  record("Intégration marquée en erreur", integAfterFail?.status === "error" && !!integAfterFail?.last_error);
  const failureAlert = await get<{ id: string }>(
    "SELECT id FROM notifications WHERE merchant_id = ? AND type = 'integration_disconnected' LIMIT 1",
    [merchantId],
  );
  record("Marchand alerté de l'échec", !!failureAlert);
  record("URL API v4 construite correctement", requestedUrls.some((u) => u.includes("/v4/spreadsheets/id-feuille-test/values/Commandes?key=")));

  // Retour au succès : même clé, mais Google répond maintenant 200.
  googleapisOk = true;
  const okSync = await syncGoogleSheet(merchantId, integId);
  record("Sync API v4 réussie : commande importée", okSync.ok === true && okSync.created === 1, okSync.ok ? `créées=${okSync.created}` : okSync.error);
  const integAfterOk = await get<{ status: string; last_error: string | null }>("SELECT status, last_error FROM integrations WHERE id = ?", [integId]);
  record("Intégration repassée à « connected », erreur effacée", integAfterOk?.status === "connected" && integAfterOk?.last_error === null);
  const gs9 = await get<{ normalized_phone: string; total: number }>(
    "SELECT normalized_phone, total FROM orders WHERE merchant_id = ? AND external_id = ?",
    [merchantId, "GS-9"],
  );
  record("Commande GS-9 importée avec normalisation", gs9?.normalized_phone === "+213777000999" && gs9?.total === 3400, `${gs9?.normalized_phone} / ${gs9?.total}`);

  // Chemin 2 : plus de clé API -> export CSV public.
  await run("UPDATE integrations SET credentials_encrypted = NULL WHERE id = ?", [integId]);
  const csvSync = await syncGoogleSheet(merchantId, integId);
  record("Sync export CSV réussie (sans clé)", csvSync.ok === true && csvSync.created === 1, csvSync.ok ? `créées=${csvSync.created}` : csvSync.error);
  record(
    "URL d'export CSV construite correctement",
    requestedUrls.some((u) => u.includes("/spreadsheets/d/id-feuille-test/export?format=csv&gid=0")),
  );
  const gs10 = await get<{ normalized_phone: string; delivery_type: string }>(
    "SELECT normalized_phone, delivery_type FROM orders WHERE merchant_id = ? AND external_id = ?",
    [merchantId, "GS-10"],
  );
  record("Commande GS-10 importée (CSV)", gs10?.normalized_phone === "+213555000888" && gs10?.delivery_type === "office");

  globalThis.fetch = realFetch;

  const missingSync = await syncGoogleSheet(merchantId, "int_inexistante");
  record("Intégration inexistante : erreur claire", missingSync.ok === false);

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
