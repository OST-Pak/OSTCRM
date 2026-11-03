/**
 * Local preview: the real API on a local PostgreSQL with synthetic demo data and a fake sign-in.
 * For looking at the app on your own computer only. It signs tokens with a key it makes at startup,
 * which no real deployment trusts, and it never runs in staging or production (server.ts is the real entry).
 *
 *   ADMIN_DATABASE_URL=postgres://postgres:local@localhost:5432/postgres pnpm --filter @ostcrm/api local
 */
import pg from "pg";
import { migrateUp } from "@ostcrm/db";
import { buildApp } from "../src/app.js";
import { adminRoutes } from "../src/routes/admin.js";
import { pipelineRoutes } from "../src/routes/pipeline.js";
import { AUDIENCE, TENANT, fakeEntra } from "../test/fake-entra.js";
import { seedDemo } from "../test/seed-demo.js";

const ADMIN = process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:local@localhost:5432/postgres";
const DB = "ostcrm_local";
const ROLES = ["owner", "admin", "bd_support", "specialist", "read_only"] as const;
const LABEL = { owner: "Saad (Owner)", admin: "Admin", bd_support: "Awais (BD support)", specialist: "Specialist", read_only: "Read only" } as const;

const urlFor = (db: string, user?: string, pass?: string) => {
  const u = new URL(ADMIN); u.pathname = "/" + db;
  if (user) { u.username = user; u.password = pass ?? ""; }
  return u.toString();
};

// 1. Database, roles and migrations.
const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();
if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB])).rowCount) await admin.query(`CREATE DATABASE ${DB}`);
await admin.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN CREATE ROLE app_worker NOLOGIN IN ROLE app_user; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ostcrm_local_app') THEN CREATE ROLE ostcrm_local_app LOGIN PASSWORD 'local-only' IN ROLE app_user; END IF;
END $$`);
await admin.end();
const owner = new pg.Client({ connectionString: urlFor(DB) });
await owner.connect();
const ran = await migrateUp(owner);
if (ran.length) console.log(`Database updated (migrations ${ran.join(", ")})`);

// 2. Demo people and data, once.
const people = {} as Record<(typeof ROLES)[number], { id: string; oid: string }>;
for (const r of ROLES) {
  const email = `${r}@local.example`;
  let row = (await owner.query("SELECT id, entra_oid FROM users WHERE email = $1", [email])).rows[0];
  if (!row) {
    row = (await owner.query("INSERT INTO users (email, display_name, entra_oid) VALUES ($1, $2, gen_random_uuid()::text) RETURNING id, entra_oid", [email, LABEL[r]])).rows[0];
    await owner.query("INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, $2, 'Local preview')", [row.id, r]);
  }
  people[r] = { id: row.id, oid: row.entra_oid };
}
if (!(await owner.query("SELECT 1 FROM companies LIMIT 1")).rowCount) {
  await seedDemo(owner, people);
  console.log("Demo data added (fictional companies only)");
}
await owner.end();

// 3. The real API, with a local sign-in key.
const entra = await fakeEntra();
const pool = new pg.Pool({ connectionString: urlFor(DB, "ostcrm_local_app", "local-only"), max: 5 });
const app = buildApp({ pool, auth: { tenantId: TENANT, audience: AUDIENCE, keys: entra.keys }, logLevel: "warn" });
await app.register(adminRoutes, { prefix: "/v1" });
await app.register(pipelineRoutes, { prefix: "/v1" });
// Local preview only: the sign-in picker asks for a token for the role you choose.
app.get("/local/sign-in", { config: { action: "public" } }, async () =>
  Promise.all(ROLES.map(async r => ({ role: r, label: LABEL[r], token: await entra.token(people[r].oid, { exp: "12h" }) }))));
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 8080) });
console.log("Local API ready on http://127.0.0.1:" + (process.env.PORT ?? 8080));
