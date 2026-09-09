/**
 * Démarre un vrai serveur PostgreSQL local (binaires natifs embarqués) pour les
 * tests d'isolation et le développement sans Docker.
 *
 *   npm run pg:start   -> démarre et écrit .pg-local.json (garde le process vivant)
 *   npm run pg:stop    -> arrête
 *
 * Ce n'est PAS le chemin de production : en staging/production, DATABASE_URL
 * pointe vers le PostgreSQL managé de Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = process.env.PG_LOCAL_DATA_DIR ?? path.join(process.cwd(), ".pg-local", "data");
const STATE = process.env.PG_LOCAL_STATE_FILE ?? path.join(process.cwd(), ".pg-local", "state.json");
const PORT = Number(process.env.PG_LOCAL_PORT ?? 55432);
const DB = process.env.PG_LOCAL_DB ?? "codwsap";
const USER = "postgres";
const PASSWORD = "postgres";

export function localUrl(db = DB) {
  return `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${db}`;
}

export async function startLocalPg(): Promise<{ url: string; stop: () => Promise<void> }> {
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const fresh = !fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    // CI/workspace containers commonly run as root, while PostgreSQL refuses
    // to start as root. Let embedded-postgres create its unprivileged runtime
    // user only in that environment; regular local development is unchanged.
    createPostgresUser: typeof process.getuid === "function" && process.getuid() === 0,
    onLog: () => {},
    onError: () => {},
  });

  if (fresh) await pg.initialise();
  await pg.start();

  try {
    await pg.createDatabase(DB);
  } catch {
    /* la base existe déjà */
  }

  fs.writeFileSync(STATE, JSON.stringify({ port: PORT, db: DB, url: localUrl() }, null, 2));
  return {
    url: localUrl(),
    stop: async () => {
      await pg.stop();
    },
  };
}

if (process.argv[1] && process.argv[1].endsWith("pg-local.ts")) {
  const cmd = process.argv[2] ?? "start";
  if (cmd === "start") {
    startLocalPg()
      .then(({ url }) => {
        console.log(`PostgreSQL local démarré : ${url}`);
        console.log("Ctrl+C pour arrêter.");
        setInterval(() => {}, 1 << 30);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  } else {
    console.log("Usage: tsx scripts/pg-local.ts start");
  }
}
