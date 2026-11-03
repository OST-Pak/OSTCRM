/**
 * Usage: DATABASE_URL=... pnpm --filter @ostcrm/db migrate up [--to N]
 *        DATABASE_URL=... pnpm --filter @ostcrm/db migrate down [--steps N]
 * Runs from the pipeline with the migrator identity, never from a laptop against production.
 */
import pg from "pg";
import { migrateDown, migrateUp } from "./migrate.js";

const [cmd, flag, val] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  if (cmd === "up") {
    const ran = await migrateUp(db, undefined, flag === "--to" ? Number(val) : undefined);
    console.log(ran.length ? `Applied ${ran.join(", ")}` : "Up to date");
  } else if (cmd === "down") {
    const n = flag === "--steps" ? Number(val) : 1;
    console.log(`Rolled back ${(await migrateDown(db, n)).join(", ") || "nothing"}`);
  } else {
    console.error("Usage: migrate up [--to N] | migrate down [--steps N]");
    process.exitCode = 2;
  }
} finally {
  await db.end();
}
