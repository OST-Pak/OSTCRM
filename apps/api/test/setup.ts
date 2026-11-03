import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from "jose";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { adminRoutes } from "../src/routes/admin.js";
import { pipelineRoutes } from "../src/routes/pipeline.js";
import { ADMIN_URL, freshDb, type TestDb } from "../../../packages/db/test/helpers.js";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const AUDIENCE = "api://ostcrm-test";

/** A fake Entra tenant: a signing key, its key set, and a token minter. */
export async function fakeEntra() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const other = await generateKeyPair("RS256");
  const token = (oid: string, o: { tid?: string; aud?: string; iss?: string; exp?: string; wrongKey?: boolean } = {}) =>
    new SignJWT({ oid, tid: o.tid ?? TENANT, name: "Test", preferred_username: `${oid}@example.com` })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.iss ?? `https://login.microsoftonline.com/${o.tid ?? TENANT}/v2.0`)
      .setAudience(o.aud ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? "1h")
      .sign(o.wrongKey ? other.privateKey : privateKey);
  return { keys, token };
}

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
