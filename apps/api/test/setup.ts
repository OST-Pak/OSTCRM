import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { AUDIENCE, TENANT, fakeEntra } from "./fake-entra.js";
export { AUDIENCE, TENANT, fakeEntra };
import { adminRoutes } from "../src/routes/admin.js";
import { pipelineRoutes } from "../src/routes/pipeline.js";
import { ADMIN_URL, freshDb, type TestDb } from "../../../packages/db/test/helpers.js";

export type Who = "owner" | "admin" | "bd_support" | "specialist" | "read_only";

export async function testApp() {
  const db: TestDb = await freshDb();
  const people = {} as Record<Who | "disabled" | "norole", { id: string; oid: string }>;
  for (const r of ["owner", "admin", "bd_support", "specialist", "read_only", "disabled", "norole"] as const) {
    const oid = randomUUID();
    const id = (await db.owner.query("INSERT INTO users (email, display_name, entra_oid, disabled_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [`${r}@example.com`, r, oid, r === "disabled" ? new Date() : null])).rows[0].id;
    if (r !== "norole") await db.owner.query("INSERT INTO role_assignments (user_id, role, reason) VALUES ($1, $2, 'test')", [id, r === "disabled" ? "bd_support" : r]);
    people[r] = { id, oid };
  }
  const url = new URL(ADMIN_URL);
  url.pathname = "/" + db.name; url.username = "ostcrm_test_app"; url.password = "test-only";
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  const entra = await fakeEntra();
  const app = buildApp({ pool, auth: { tenantId: TENANT, audience: AUDIENCE, keys: entra.keys }, logLevel: "silent" });
  await app.register(adminRoutes, { prefix: "/v1" });
  await app.register(pipelineRoutes, { prefix: "/v1" });
  await app.ready();
  const auth = async (who: keyof typeof people) => ({ authorization: `Bearer ${await entra.token(people[who].oid)}` });
  return {
    app, db, people, entra, auth,
    async close() { await app.close(); await pool.end(); await db.drop(); }
  };
}
