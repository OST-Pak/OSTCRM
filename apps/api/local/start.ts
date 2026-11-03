/**
 * Local preview: the real API on a local PostgreSQL with a fake sign-in, showing demo data or, if you put
 * your export in local-data/, your real CRM data.
 * For looking at the app on your own computer only. It signs tokens with a key it makes at startup,
 * which no real deployment trusts, and it never runs in staging or production (server.ts is the real entry).
 *
 *   ADMIN_DATABASE_URL=postgres://postgres:local@localhost:5432/postgres pnpm --filter @ostcrm/api local
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadTransformed, migrateUp, reportMarkdown, transformExport, type ArtifactExport, type PersonMapping } from "@ostcrm/db";
import { buildApp } from "../src/app.js";
import { adminRoutes } from "../src/routes/admin.js";
import { pipelineRoutes } from "../src/routes/pipeline.js";
import { prospectRoutes } from "../src/routes/prospects.js";
import { companyRoutes } from "../src/routes/company.js";
import { boardRoutes } from "../src/routes/board.js";
import { AUDIENCE, TENANT, fakeEntra } from "../test/fake-entra.js";
import { seedDemo } from "../test/seed-demo.js";

const ADMIN = process.env.ADMIN_DATABASE_URL ?? "postgres://postgres:local@localhost:5432/postgres";
/**
 * Real data: put the file from the live CRM's "Export all data" button in LOCAL_DATA_DIR (default ./local-data).
 * It loads once into its own database, ostcrm_local_real, so the demo database is never mixed with it.
 * The file stays on this computer; local-data/ is ignored by git and by the Docker image.
 */
const DATA_DIR = process.env.LOCAL_DATA_DIR ?? join(process.cwd(), "..", "..", "local-data");
const exportFile = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter(f => /^oak-street-crm-export-.*\.json$/.test(f)).sort().pop() : undefined;
const REAL = !!exportFile;
const DB = REAL ? "ostcrm_local_real" : "ostcrm_local";
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

// 2. People and data, once: your real export if there is one, else demo data.
let people: Record<string, { id: string; oid: string; label: string }> = {};
const hasData = !!(await owner.query("SELECT 1 FROM companies LIMIT 1")).rowCount;
if (REAL && !hasData) {
  const x = JSON.parse(readFileSync(join(DATA_DIR, exportFile!), "utf8")) as ArtifactExport;
  const cfg = new Map((x.collections.config ?? []).map(c => [c.id, c]));
  const names = new Set<string>(["Saad"]);
  for (const m of x.collections.members ?? []) if (m.member) names.add(String(m.member));
  for (const n of Object.keys((cfg.get("team")?.emails ?? {}) as Record<string, string>)) names.add(n);
  const map: PersonMapping[] = [...names].map(n => ({ teamName: n, displayName: n, email: `${n.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@local.example` }));
  const t = transformExport(x, { people: map });
  await loadTransformed(owner, t);
  await owner.query("UPDATE users SET entra_oid = gen_random_uuid()::text WHERE entra_oid IS NULL");
  try { writeFileSync(join(DATA_DIR, "import-report.md"), reportMarkdown(t.report)); } catch { /* folder is read only; the counts below still show */ }
  console.log(`Your CRM export loaded: ${t.report.out.companies} companies, ${t.report.out.contacts} contacts, ${t.report.rejected.length} rejected. Report: local-data/import-report.md`);
}
if (!REAL) {
  for (const r of ROLES) {
    const email = `${r}@local.example`;
    if (!(await owner.query("SELECT 1 FROM users WHERE email = $1", [email])).rowCount) {
      const u = (await owner.query("INSERT INTO users (email, display_name, entra_oid) VALUES ($1, $2, gen_random_uuid()::text) RETURNING id", [email, LABEL[r]])).rows[0];
      await owner.query("INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, $2, 'Local preview')", [u.id, r]);
    }
  }
  if (!hasData) {
    const ids = Object.fromEntries((await owner.query("SELECT r.role, u.id FROM users u JOIN role_assignments r ON r.user_id = u.id AND r.archived_at IS NULL")).rows.map(x => [x.role, { id: x.id }]));
    await seedDemo(owner, ids as Parameters<typeof seedDemo>[1]);
    console.log("Demo data added (fictional companies only)");
  }
}
const ROLE_NAME = { owner: "Owner", admin: "Admin", bd_support: "BD support", specialist: "Specialist", read_only: "Read only" } as Record<string, string>;
for (const u of (await owner.query(`SELECT u.id, u.entra_oid, u.display_name, r.role FROM users u JOIN role_assignments r ON r.user_id = u.id AND r.archived_at IS NULL
                                    WHERE u.archived_at IS NULL AND u.disabled_at IS NULL ORDER BY (r.role = 'owner') DESC, u.display_name`)).rows) {
  people[u.id] = { id: u.id, oid: u.entra_oid, label: REAL ? `${u.display_name} (${ROLE_NAME[u.role]})` : u.display_name };
}
// 3. The real API, with a local sign-in key.
const entra = await fakeEntra();
const pool = new pg.Pool({ connectionString: urlFor(DB, "ostcrm_local_app", "local-only"), max: 5 });
const app = buildApp({ pool, auth: { tenantId: TENANT, audience: AUDIENCE, keys: entra.keys }, logLevel: "warn" });
await app.register(adminRoutes, { prefix: "/v1" });
await app.register(pipelineRoutes, { prefix: "/v1" });
await app.register(prospectRoutes, { prefix: "/v1" });
await app.register(companyRoutes, { prefix: "/v1" });
await app.register(boardRoutes, { prefix: "/v1" });
// Local preview only: the sign-in picker asks for a token for the role you choose.
app.get("/local/sign-in", { config: { action: "public" } }, async () =>
  Promise.all(Object.values(people).map(async p => ({ label: p.label, token: await entra.token(p.oid, { exp: "12h" }) }))));
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 8080) });
console.log(`Local API ready on http://127.0.0.1:${process.env.PORT ?? 8080} (${REAL ? "your CRM data" : "demo data"})`);
