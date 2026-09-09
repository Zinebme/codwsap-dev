/** Insert missing starters only. Run with staging DATABASE_URL explicitly set. */
import { all, closeDb } from "../src/server/db";
import { seedTemplates } from "../src/server/services/seedTemplates";

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--merchant" || !args[1].trim())) {
    throw new Error("Usage: npm run templates:backfill -- [--merchant <merchantId>]");
  }
  if (!process.env.DATABASE_URL || process.env.DB_DRIVER === "sqlite") {
    throw new Error("Set DATABASE_URL to the intended PostgreSQL database before backfilling.");
  }
  const merchants = await all<{ id: string }>(
    `SELECT id FROM merchants${args.length ? " WHERE id = ?" : ""} ORDER BY id`,
    args.length ? [args[1]] : [],
  );
  if (args.length && !merchants.length) throw new Error("Merchant not found.");
  const summary = { merchantsProcessed: 0, templatesCreated: 0, alreadyExisted: 0, languagesCreated: { ar: 0, fr: 0, en: 0 }, errors: 0 };
  for (const merchant of merchants) {
    summary.merchantsProcessed++;
    try {
      const result = await seedTemplates(merchant.id);
      summary.templatesCreated += result.created;
      summary.alreadyExisted += result.existed;
      for (const language of ["ar", "fr", "en"] as const) summary.languagesCreated[language] += result.languages[language];
    } catch {
      summary.errors++;
      console.error(`Backfill failed for merchant ${merchant.id}; retry after checking database access/schema.`);
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Backfill failed");
  process.exitCode = 1;
}).finally(closeDb);
