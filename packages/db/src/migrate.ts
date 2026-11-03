import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";

export interface Migration { version: number; name: string; up: string; down: string; checksum: string }

export const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url).pathname;

/**
 * Reads `NNNN_name.up.sql` / `NNNN_name.down.sql` pairs. Every migration must have a down path,
 * versions must be consecutive from 1, and the checksum covers the up script.
 */
export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir).filter(f => f.endsWith(".sql"));
  const ups = files.filter(f => f.endsWith(".up.sql")).sort();
  return ups.map((f, i) => {
    const m = /^(\d{4})_([a-z0-9_]+)\.up\.sql$/.exec(f);
    if (!m) throw new Error(`Bad migration file name: ${f}`);
    const version = Number(m[1]);
    if (version !== i + 1) throw new Error(`Migrations must be numbered consecutively from 0001; found ${f} at position ${i + 1}`);
    const downFile = `${m[1]}_${m[2]}.down.sql`;
    if (!files.includes(downFile)) throw new Error(`Migration ${f} has no down path (${downFile})`);
    const up = readFileSync(join(dir, f), "utf8");
    return { version, name: m[2]!, up, down: readFileSync(join(dir, downFile), "utf8"), checksum: createHash("sha256").update(up).digest("hex") };
  });
}

const TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

async function applied(db: Client): Promise<Map<number, { name: string; checksum: string }>> {
  await db.query(TABLE);
  const r = await db.query<{ version: number; name: string; checksum: string }>("SELECT version, name, checksum FROM schema_migrations ORDER BY version");
  return new Map(r.rows.map(x => [x.version, { name: x.name, checksum: x.checksum }]));
}

/**
 * Applies pending migrations in order, each in its own transaction, under an advisory lock so two
 * deploys cannot migrate at once. Refuses to run if an applied migration's file has been edited.
 */
export async function migrateUp(db: Client, migrations = loadMigrations(), to?: number): Promise<number[]> {
  await db.query("SELECT pg_advisory_lock(7300101)");
  try {
    const done = await applied(db);
    for (const m of migrations) {
      const prev = done.get(m.version);
      if (prev && prev.checksum !== m.checksum) {
        throw new Error(`Migration ${m.version}_${m.name} was edited after it ran. Add a new migration instead.`);
      }
    }
    const ran: number[] = [];
    for (const m of migrations) {
      if (done.has(m.version) || (to !== undefined && m.version > to)) continue;
      await db.query("BEGIN");
      try {
        await db.query(m.up);
        await db.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [m.version, m.name, m.checksum]);
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw new Error(`Migration ${m.version}_${m.name} failed: ${(e as Error).message}`);
      }
      ran.push(m.version);
    }
    return ran;
  } finally {
    await db.query("SELECT pg_advisory_unlock(7300101)");
  }
}

/** Rolls back the latest `steps` applied migrations, newest first. */
export async function migrateDown(db: Client, steps = 1, migrations = loadMigrations()): Promise<number[]> {
  await db.query("SELECT pg_advisory_lock(7300101)");
  try {
    const done = [...(await applied(db)).keys()].sort((a, b) => b - a).slice(0, steps);
    for (const v of done) {
      const m = migrations.find(x => x.version === v);
      if (!m) throw new Error(`No down path on disk for applied migration ${v}`);
      await db.query("BEGIN");
      try {
        await db.query(m.down);
        await db.query("DELETE FROM schema_migrations WHERE version = $1", [v]);
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw new Error(`Rollback of ${m.version}_${m.name} failed: ${(e as Error).message}`);
      }
    }
    return done;
  } finally {
    await db.query("SELECT pg_advisory_unlock(7300101)");
  }
}
