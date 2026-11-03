import { randomBytes } from "node:crypto";
import pg from "pg";
import { migrateUp } from "../src/migrate.js";
import { setRequestContext, type Role } from "../src/session.js";

/**
 * Tests need a real PostgreSQL 16. Set TEST_DATABASE_URL to a superuser connection on a throwaway
 * server (CI runs one as a service container). Each test file gets its own fresh database.
 */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "";
if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL is not set. Point it at a throwaway PostgreSQL 16 server (superuser).");

const urlFor = (db: string, user?: string) => {
  const u = new URL(ADMIN_URL);
  u.pathname = "/" + db;
  if (user) { u.username = user; u.password = "test-only"; }
  return u.toString();
};

export interface TestDb { name: string; owner: pg.Client; app: pg.Client; drop(): Promise<void> }

/** A fresh database with all migrations applied. `owner` bypasses RLS; `app` connects as a member of app_user. */
export async function freshDb(opts: { migrate?: boolean } = {}): Promise<TestDb> {
  const name = "ostcrm_test_" + randomBytes(5).toString("hex");
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ostcrm_test_app') THEN
      CREATE ROLE ostcrm_test_app LOGIN PASSWORD 'test-only' IN ROLE app_user;
    END IF; END $$`);
  await admin.end();
  const owner = new pg.Client({ connectionString: urlFor(name) });
  await owner.connect();
  if (opts.migrate !== false) await migrateUp(owner);
  const app = new pg.Client({ connectionString: urlFor(name, "ostcrm_test_app") });
  await app.connect();
  return {
    name, owner, app,
    async drop() {
      await app.end(); await owner.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    }
  };
}

/** Runs `fn` as `role` inside a transaction that is always rolled back. */
export async function as<T>(db: pg.Client, userId: string | null, role: Role, fn: (db: pg.Client) => Promise<T>): Promise<T> {
  await db.query("BEGIN");
  try {
    await setRequestContext(db, { userId, role, requestId: "test-" + randomBytes(3).toString("hex") });
    return await fn(db);
  } finally {
    await db.query("ROLLBACK");
  }
}

/** Seeds one user per role (as the table owner) and returns their ids. */
export async function seedPeople(owner: pg.Client): Promise<Record<Exclude<Role, "system">, string>> {
  const roles = ["owner", "admin", "bd_support", "specialist", "read_only"] as const;
  const out = {} as Record<(typeof roles)[number], string>;
  for (const r of roles) {
    const u = await owner.query<{ id: string }>("INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id", [`${r}@example.com`, r]);
    out[r] = u.rows[0]!.id;
    await owner.query("INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, $2, 'seed')", [out[r], r]);
  }
  return out;
}

/** The Postgres error code of a rejected promise, or "ok". */
export async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; }
}

/** Runs one statement inside a savepoint so a refusal does not abort the surrounding transaction. Returns the error code or "ok". */
export async function attempt(db: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("SAVEPOINT attempt");
  try { await db.query(sql, params); await db.query("RELEASE SAVEPOINT attempt"); return "ok"; }
  catch (e) { await db.query("ROLLBACK TO SAVEPOINT attempt"); return (e as { code?: string }).code ?? (e as Error).message; }
}
